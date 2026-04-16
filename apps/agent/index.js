require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const { execSync } = require('child_process');
const path = require('path');
const { triageIssues } = require('./triage');

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:4000';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In Docker, the repo is mounted at /workspace.
// We MUST explicitly change to /workspace for Git commands to have the right context.
try {
  process.chdir('/workspace');
  console.log('[Agent] 📂 Working directory changed to /workspace');
} catch (err) {
  console.log(`[Agent] ⚠️ Could not chdir to /workspace. Ensure it is mounted! (${err.message})`);
}

// Fix "dubious ownership" — volume mounts have different uid/gid than container user
try {
  execSync('git config --global --add safe.directory /workspace', { encoding: 'utf8', stdio: 'pipe' });
  console.log('[Agent] Configured Git safe.directory for /workspace');
} catch (err) {
  console.log(`[Agent] ⚠️ Could not set safe.directory: ${err.message}`);
}

// Force all git commands to strictly run in /workspace
const WORKSPACE_DIR = '/workspace';

// ─── Helper: Call MCP /run-tests ───────────────────────────────────────
async function runTests() {
  console.log('[Agent] 🧪 Running tests via MCP server...');
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

// ─── Helper: Wait for MCP server to be ready ───────────────────────────
async function waitForMCP(maxRetries = 10, intervalMs = 3000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      console.log(`[Agent] Checking MCP at ${MCP_SERVER_URL}/health... (attempt ${i}/${maxRetries})`);
      await axios.get(`${MCP_SERVER_URL}/health`, { timeout: 5000 });
      console.log('[Agent] ✅ MCP server is ready.');
      return;
    } catch {
      console.log(`[Agent] ⏳ MCP not ready, retrying in ${intervalMs / 1000}s...`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`MCP server not reachable after ${maxRetries} attempts at ${MCP_SERVER_URL}`);
}

// ─── Helper: Sync to latest main branch ────────────────────────────────
function syncToLatestMain() {
  console.log('[Agent] 🔄 Syncing to latest code on main...');
  try {
    // Discard any local changes from previous cycle
    gitExec('git checkout -- .');
    gitExec('git clean -fd');
  } catch {
    // Ignore if nothing to clean
  }

  try {
    gitExec('git checkout main');
  } catch {
    try {
      gitExec('git checkout master');
    } catch {
      console.log('[Agent] ⚠️  Could not checkout main/master, staying on current branch.');
    }
  }

  try {
    gitExec('git pull origin main');
    console.log('[Agent] ✅ Code synced to latest main.');
  } catch {
    try {
      gitExec('git pull origin master');
      console.log('[Agent] ✅ Code synced to latest master.');
    } catch (err) {
      console.log(`[Agent] ⚠️  Could not pull latest: ${err.message}. Continuing with current state.`);
    }
  }
}

// ─── Single Pipeline Cycle ─────────────────────────────────────────────
async function runCycle(cycleNumber) {
  console.log(`\n[Agent] ╔══════════════════════════════════════════════╗`);
  console.log(`[Agent] ║  Pipeline Cycle #${cycleNumber} — ${new Date().toISOString()}  ║`);
  console.log(`[Agent] ╚══════════════════════════════════════════════╝\n`);

  // ── Step 1: Sync to latest main ────────────────────────────────
  syncToLatestMain();

  // ── Step 2: Run tests ──────────────────────────────────────────
  const testResults = await runTests();

  if (testResults.success) {
    console.log('[Agent] ✅ All tests passed! No action needed this cycle.');
    return;
  }

  // ── Step 3: Collect failures ───────────────────────────────────
  const failures = testResults.failures || [];

  if (failures.length === 0) {
    console.log('[Agent] ⚠️  Tests reported failure but no structured failures found. Skipping.');
    return;
  }

  console.log(`[Agent] ❌ ${failures.length} test failure(s) detected.`);
  failures.forEach((f, i) => {
    console.log(`[Agent]   ${i + 1}. [${f.type}] ${f.test}: ${f.error.substring(0, 120)}`);
  });

  // ── Step 4: Triage (CRITICAL + top 2 HIGH only) ────────────────
  console.log('[Agent] 🔍 Running triage...');
  const prioritizedIssues = await triageIssues(failures);

  if (prioritizedIssues.length === 0) {
    console.log('[Agent] Triage result: no issues prioritized for fixing. Skipping.');
    return;
  }

  console.log(`[Agent] Triage result: ${prioritizedIssues.length} issue(s) to fix.`);

  // ── Step 5: Create a fix branch ────────────────────────────────
  const branchName = `ai-fix-${Date.now()}`;
  console.log(`[Agent] 🌿 Branch created: ${branchName}`);
  gitExec(`git checkout -b ${branchName}`);

  let fixesApplied = 0;

  // ── Step 6: Fix each prioritized issue ─────────────────────────
  for (let i = 0; i < prioritizedIssues.length; i++) {
    const issueObj = prioritizedIssues[i];
    const failure = issueObj.originalIssue;

    console.log(`\n[Agent] ── Fixing prioritized issue ${i + 1}/${prioritizedIssues.length} ──`);
    console.log(`[Agent]    Severity: ${issueObj.severity} | Type: ${issueObj.type}`);
    console.log(`[Agent]    Test: ${failure.test}`);
    console.log(`[Agent]    Error: ${failure.error.substring(0, 150)}`);

    // 6a. Context extraction — ask LLM which file is likely causing the issue
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
Return ONLY the relative file path (e.g., "apps/frontend/src/pages/Dashboard.jsx"). No explanation.`;

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

    // 6b. Read the suspect file
    let fileContent;
    let actualFilePath = suspectFilePath;

    console.log(`[Agent] Using file: ${actualFilePath}`);
    try {
      fileContent = await readFile(actualFilePath);
      console.log(`[Agent] File exists: true`);
    } catch (err) {
      console.log(`[Agent] File exists: false`);
      console.log(`[Agent] 🔍 Running fallback search for correct file...`);

      try {
        // Fallback: strictly find files in frontend containing "create", "button", or "testid"
        const grepOutput = execSync(`git grep -ilE "create|button|testid" -- apps/frontend/src/ || true`, { cwd: WORKSPACE_DIR, encoding: 'utf8' }).trim();
        const foundFiles = grepOutput.split('\n').filter(Boolean);

        if (foundFiles.length > 0) {
          const fallbackPrompt = `The previous file did not exist. The test failed with:
${failure.error}

Here are the EXISTING files related to components, buttons, and tests:
${foundFiles.join('\n')}

Identify which of these EXISTING files is most likely causing the issue. Return ONLY the exact file path from the list.`;

          const fallbackRes = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: fallbackPrompt }]
          });

          actualFilePath = fallbackRes.choices[0].message.content.trim().replace(/['"`]/g, '');
          console.log(`[Agent] Using file: ${actualFilePath}`);

          fileContent = await readFile(actualFilePath);
          console.log(`[Agent] File exists: true`);
        } else {
          throw new Error("No fallback files matched keywords");
        }
      } catch (fallbackErr) {
        console.log(`[Agent] ⚠️  Skipping invalid file. Fallback failed: ${fallbackErr.message}`);
        continue;
      }
    }

    // 6c. Generate minimal fix via LLM
    console.log(`[Agent]    Generating fix...`);
    const fixPrompt = `You are fixing a bug in a React + Node.js application.

FAILING TEST:
- Test name: ${failure.test}
- Error: ${failure.error}
- Type: ${failure.type}

FILE TO FIX: ${actualFilePath}
\`\`\`
${fileContent}
\`\`\`

IMPORTANT RULES:
- Make the MINIMUM change needed to fix the issue.
- Do NOT refactor, rename, or restructure code.
- Preserve all existing comments and formatting.
- Only change what is broken.

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

    // 6d. Apply the fix (file write via MCP)
    const applyResult = await applyFix(actualFilePath, newContent);
    console.log(`[Agent]    ✅ Fix applied successfully`);
    console.log(`[Agent]    ✅ File updated: ${actualFilePath}`);

    // 6e. Stage and commit only the changed file
    gitExec(`git add ${actualFilePath}`);
    gitExec(`git commit -m "fix: ${issueObj.severity} - ${failure.test} (${actualFilePath})"`);
    fixesApplied++;

    console.log(`[Agent]    ✅ Git commit successful`);
  }

  // ── Step 7: Push branch + Create PR ────────────────────────────
  if (fixesApplied > 0) {
    console.log(`\n[Agent] 🚀 Pushing branch ${branchName} with ${fixesApplied} fix(es)...`);
    gitExec(`git push origin ${branchName}`);
    console.log(`[Agent] ✅ Pushed to origin successfully.`);

    try {
      // Create PR via GitHub CLI
      const prOutput = execSync(`gh pr create --title "AI Fix: Automated Remediation (${branchName})" --body "The AI Agent automatically detected test failures and applied these fixes." --base main --head ${branchName}`, { cwd: WORKSPACE_DIR, encoding: 'utf8', stdio: 'pipe' });
      console.log(`[Agent] ✅ PR created: ${prOutput.trim()}`);
    } catch (err) {
      console.log(`[Agent] ⚠️  Unable to create PR via CLI: Ensure GITHUB_TOKEN is set. (${err.message.substring(0, 100)})`);
      console.log(`[Agent] 🔗 Manually create a PR from '${branchName}' → 'main'`);
    }

  } else {
    console.log('[Agent] No fixes were applied. Cleaning up branch...');
    try {
      gitExec('git checkout main 2>/dev/null || git checkout master');
      gitExec(`git branch -D ${branchName}`);
    } catch {
      // Best-effort cleanup
    }
  }
}

// ─── Express API Server (Orchestration-Triggered) ─────────────────────
const express = require('express');
const app = express();
const AGENT_PORT = parseInt(process.env.AGENT_PORT) || 3001;

app.use(express.json());

// Concurrency guard — only one pipeline at a time
let isRunning = false;
let pipelineCount = 0;

// ─── Startup: configure git identity ──────────────────────────────────
console.log('\n[Agent] ============================================');
console.log('[Agent] 🤖 AI DevOps Agent — API Mode');
console.log(`[Agent] MCP server: ${MCP_SERVER_URL}`);
console.log('[Agent] ============================================\n');

console.log('[Agent] 🔧 Configuring global Git identity...');
try {
  gitExec('git config --global user.name "AI DevOps Agent"');
  gitExec('git config --global user.email "agent@ai-devops.local"');
} catch (err) {
  console.log(`[Agent] ⚠️  Warning: Failed to configure git identity. Commits may fail. (${err.message})`);
}

// ─── GET /health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    isRunning,
    pipelineCount,
    uptime: process.uptime()
  });
});

// ─── POST /run-pipeline ───────────────────────────────────────────────
app.post('/run-pipeline', async (req, res) => {
  if (isRunning) {
    console.log('[Agent] ⚠️  Pipeline already running. Rejecting request.');
    return res.status(409).json({
      status: 'rejected',
      message: 'Pipeline is already running. Try again later.'
    });
  }

  // Respond immediately, run pipeline in background
  res.json({
    status: 'started',
    message: 'Pipeline execution triggered'
  });

  // Execute pipeline asynchronously
  isRunning = true;
  pipelineCount++;
  const cycleNum = pipelineCount;

  try {
    // Ensure MCP is reachable before running
    await waitForMCP(5, 2000);
    await runCycle(cycleNum);
    console.log(`[Agent] ✅ Pipeline #${cycleNum} completed successfully.`);
  } catch (err) {
    console.error(`[Agent] ❌ Pipeline #${cycleNum} failed:`, err.response?.data || err.message);
  } finally {
    isRunning = false;
  }
});

// ─── Start Server ─────────────────────────────────────────────────────
app.listen(AGENT_PORT, () => {
  console.log(`[Agent] 🚀 Agent API listening on port ${AGENT_PORT}`);
  console.log(`[Agent] 📡 Trigger pipeline: POST http://localhost:${AGENT_PORT}/run-pipeline`);
});
