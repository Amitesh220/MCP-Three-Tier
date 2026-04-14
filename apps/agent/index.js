const axios = require('axios');
const OpenAI = require('openai');
const { triageIssues } = require('./triage');

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:4000';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function runTests() {
  console.log('Triggering E2E tests...');
  const res = await axios.post(`${MCP_SERVER_URL}/run-tests`);
  return res.data;
}

async function readFile(filePath) {
  console.log(`Reading file: ${filePath}`);
  const res = await axios.post(`${MCP_SERVER_URL}/read-file`, { filePath });
  return res.data.content;
}

async function applyFix(filePath, content, branchName, commitMessage) {
  console.log(`Applying fix to ${filePath}...`);
  const res = await axios.post(`${MCP_SERVER_URL}/apply-fix`, {
    filePath, content, branchName, commitMessage
  });
  return res.data;
}

async function main() {
  try {
    const testResults = await runTests();
    
    if (testResults.success) {
      console.log('All tests passed! No action needed.');
      return;
    }

    console.log('Tests failed. Collecting and triaging results...');

    // Collect distinct failures
    let failuresList = [];
    if (testResults.report?.errors && testResults.report.errors.length > 0) {
      failuresList = testResults.report.errors.map(e => e.message);
    } else if (testResults.stderr) {
      failuresList = [testResults.stderr];
    } else {
      failuresList = ['Unknown error encountered during testing.'];
    }

    // NEW FLOW: Intelligent Triage Step
    const prioritizedIssues = await triageIssues(failuresList);

    if (prioritizedIssues.length === 0) {
      console.log('No issues were prioritized for fixing. Exiting.');
      return;
    }

    for (let i = 0; i < prioritizedIssues.length; i++) {
      const issueObj = prioritizedIssues[i];
      const failureContext = issueObj.originalIssue;
      console.log(`\\n========== FIXING ISSUE ${i + 1}/${prioritizedIssues.length} (Severity: ${issueObj.severity}) ==========`);

      // 1. Context Extraction using LLM
      const triagePrompt = `Test Failures:\\n${failureContext}\\n\\nAnalyze the failures and extract the most likely file causing the issue. Return ONLY the file path (e.g., 'apps/frontend/src/App.jsx').`;
      
      const contextResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: triagePrompt }]
      });

      const suspectFilePath = contextResponse.choices[0].message.content.trim();
      if (!suspectFilePath) {
         console.log('Could not identify a file to fix. Skipping...');
         continue;
      }

      // 2. Read context
      let fileContent;
      try {
        fileContent = await readFile(suspectFilePath);
      } catch (err) {
        console.log(`Failed to read file ${suspectFilePath}:`, err.message);
        continue;
      }

      // 3. Generate Fix
      console.log(`Generating fix for ${suspectFilePath}...`);
      const fixPrompt = `Given the following failing tests:\\n${failureContext}\\n\\nAnd the content of ${suspectFilePath}:\\n\`\`\`\\n${fileContent}\\n\`\`\`\\n\\nPlease provide the complete updated code for this file that fixes the issue. Return ONLY the raw code, without markdown blocks.`;

      const fixResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: fixPrompt }]
      });

      let newContent = fixResponse.choices[0].message.content.trim();
      // Remove markdown if LLM adds it despite instructions
      if (newContent.startsWith('\`\`\`')) {
        newContent = newContent.replace(/^\`\`\`[a-z]*\\n/, '').replace(/\\n\`\`\`$/, '');
      }

      // 4. Apply Fix
      const branchName = `ai-fix-${Date.now()}`;
      const commitMsg = `Fix test failures in ${suspectFilePath}`;
      const applyResult = await applyFix(suspectFilePath, newContent, branchName, commitMsg);
      
      console.log('Fix applied successfully:', applyResult);
    }

  } catch (err) {
    console.error('Agent workflow encountered an error:', err.response?.data || err.message);
  }
}

main();
