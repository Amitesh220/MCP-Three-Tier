require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const { execSync } = require('child_process');
const path = require('path');
const { triageIssues } = require('./triage');

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:4000';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In Docker, the repo is mounted at /workspace. Switch cwd so git operations work.
try {
  process.chdir('/workspace');
  console.log('[Agent] Working directory set to /workspace');
} catch {
  console.log(`[Agent] /workspace not found, using default cwd: ${process.cwd()}`);
}

const WORKSPACE_DIR = process.cwd();

// ─── Helper: Call MCP /run-tests ───────────────────────────────────────
async function runTests() {
  console.log('[Agent] Triggering E2E tests via MCP server...');
  const res = await axios.post(`${MCP_SERVER_URL}/run-tests`, {}, { timeout: 180000 });
  return res.data;
}

// ─── Helper: Call MCP /read-file ───────────────────────────────────────
async function readFile(filePath) {
  console.log(`[Agent] Reading file: ${filePath}`);
  const res = await axios.post(`${MCP_SERVER_URL}/read-file`, { filePath });
  return res.data.content;
}

// ─── Helper: Call MCP /apply-fix (file write only) ─────────────────────
async function applyFix(filePath, content) {
  console.log(`[Agent] Applying fix to ${filePath}...`);
  const res = await axios.post(`${MCP_SERVER_URL}/apply-fix`, { filePath, content });
  return res.data;
}

// ─── Helper: Execute git commands in the workspace ─────────────────────
function gitExec(command) {
  console.log(`[Agent] Git: ${command}`);
  return execSync(command, { cwd: WORKSPACE_DIR, encoding: 'utf8', stdio: 'pipe' });
}

// ─── Main Agent Flow ───────────────────────────────────────────────────
async function main() {
  console.log('\n[Agent] ============================================');
  console.log('[Agent] AI DevOps Agent started');
  console.log('[Agent] ============================================\n');

  try {
    // ── Step 1: Run tests ──────────────────────────────────────────
    const testResults = await runTests();

    if (testResults.success) {
      console.log('[Agent] ✅ All tests passed! No action needed.');
      return;
    }

    // ── Step 2: Collect failures ───────────────────────────────────
    const failures = testResults.failures || [];

    if (failures.length === 0) {
      console.log('[Agent] ⚠️  Tests reported failure but no structured failures found. Exiting.');
      return;
    }

    console.log(`[Agent] ❌ ${failures.length} test failure(s) detected.`);
    failures.forEach((f, i) => {
      console.log(`[Agent]   ${i + 1}. [${f.type}] ${f.test}: ${f.error.substring(0, 120)}`);
    });

    // ── Step 3: Triage ─────────────────────────────────────────────
    const prioritizedIssues = await triageIssues(failures);

    if (prioritizedIssues.length === 0) {
      console.log('[Agent] No issues were prioritized for fixing. Exiting.');
      return;
    }

    // ── Step 4: Create a single branch for all fixes ───────────────
    const branchName = `ai-fix-${Date.now()}`;
    console.log(`[Agent] Creating branch: ${branchName}`);

    try {
      gitExec('git checkout main 2>/dev/null || git checkout master');
    } catch {
      console.log('[Agent] Could not checkout main/master, continuing on current branch.');
    }
    gitExec(`git checkout -b ${branchName}`);

    let fixesApplied = 0;

    // ── Step 5: Fix each prioritized issue ─────────────────────────
    for (let i = 0; i < prioritizedIssues.length; i++) {
      const issueObj = prioritizedIssues[i];
      const failure = issueObj.originalIssue;

      console.log(`\n[Agent] ── Fixing issue ${i + 1}/${prioritizedIssues.length} ──`);
      console.log(`[Agent]    Severity: ${issueObj.severity} | Type: ${issueObj.type}`);
      console.log(`[Agent]    Test: ${failure.test}`);
      console.log(`[Agent]    Error: ${failure.error.substring(0, 150)}`);

      // 5a. Context extraction — ask LLM which file is likely causing the issue
      const triagePrompt = `You are analyzing a test failure in a React + Node.js monorepo.

Test name: ${failure.test}
Error message: ${failure.error}
Error type: ${failure.type}
Logs: ${failure.logs || 'N/A'}

The project structure is:
- apps/frontend/src/ (React components, pages, api.js)
- apps/backend/ (Express server, routes/, models/)
- apps/mcp-server/ (Playwright test runner)

Based on the error, identify the SINGLE most likely file causing this issue.
Return ONLY the relative file path (e.g., "apps/frontend/src/App.jsx"). No explanation.`;

      const contextResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: triagePrompt }]
      });

      const suspectFilePath = contextResponse.choices[0].message.content.trim().replace(/['"`]/g, '');

      if (!suspectFilePath || suspectFilePath.includes(' ')) {
        console.log(`[Agent] ⚠️  Could not identify a valid file path. Got: "${suspectFilePath}". Skipping.`);
        continue;
      }

      console.log(`[Agent]    Suspect file: ${suspectFilePath}`);

      // 5b. Read the suspect file
      let fileContent;
      try {
        fileContent = await readFile(suspectFilePath);
      } catch (err) {
        console.log(`[Agent] ⚠️  Failed to read file ${suspectFilePath}: ${err.message}. Skipping.`);
        continue;
      }

      // 5c. Generate fix via LLM
      console.log(`[Agent]    Generating fix...`);
      const fixPrompt = `You are fixing a bug in a React + Node.js application.

FAILING TEST:
- Test name: ${failure.test}
- Error: ${failure.error}
- Type: ${failure.type}

FILE TO FIX: ${suspectFilePath}
\`\`\`
${fileContent}
\`\`\`

Provide the COMPLETE updated code for this file that fixes the issue.
Return ONLY the raw source code. Do NOT wrap in markdown code blocks.
Do NOT add any explanations before or after the code.`;

      const fixResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: fixPrompt }]
      });

      let newContent = fixResponse.choices[0].message.content.trim();

      // Strip markdown fences if LLM adds them despite instructions
      if (newContent.startsWith('```')) {
        newContent = newContent.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
      }

      // 5d. Apply the fix (file write via MCP)
      const applyResult = await applyFix(suspectFilePath, newContent);
      console.log(`[Agent]    ✅ Fix applied: ${applyResult.message}`);

      // 5e. Stage and commit
      gitExec(`git add ${suspectFilePath}`);
      gitExec(`git commit -m "fix: ${issueObj.severity} - ${failure.test} (${suspectFilePath})"`);
      fixesApplied++;

      console.log(`[Agent]    ✅ Committed fix for ${suspectFilePath}`);
    }

    // ── Step 6: Push branch ────────────────────────────────────────
    if (fixesApplied > 0) {
      console.log(`\n[Agent] Pushing branch ${branchName} with ${fixesApplied} fix(es)...`);
      gitExec(`git push origin ${branchName}`);
      console.log(`[Agent] ✅ Branch pushed successfully.`);
      console.log(`[Agent] 🔗 Create a PR from '${branchName}' → 'main' to review the fixes.`);
    } else {
      console.log('[Agent] No fixes were applied. Cleaning up branch...');
      try {
        gitExec('git checkout main 2>/dev/null || git checkout master');
        gitExec(`git branch -D ${branchName}`);
      } catch {
        // Best-effort cleanup
      }
    }

  } catch (err) {
    console.error('[Agent] ❌ Workflow error:', err.response?.data || err.message);
    process.exit(1);
  }

  console.log('\n[Agent] ============================================');
  console.log('[Agent] Agent workflow completed');
  console.log('[Agent] ============================================\n');
}

main();
