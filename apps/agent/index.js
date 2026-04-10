const axios = require('axios');
const OpenAI = require('openai');

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

    console.log('Tests failed. Triaging results...');

    // Simple analysis of failures
    const failures = testResults.report?.errors?.map(e => e.message).join('\\n') || testResults.stderr || 'Unknown error';

    // 1. Triage using LLM
    const triagePrompt = `Test Failures:\\n${failures}\\n\\nAnalyze the failures and extract the most likely file causing the issue. Return ONLY the file path (e.g., 'apps/frontend/src/App.jsx').`;
    
    const contextResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: triagePrompt }]
    });

    const suspectFilePath = contextResponse.choices[0].message.content.trim();
    if (!suspectFilePath) {
       console.log('Could not identify a file to fix.');
       return;
    }

    // 2. Read context
    let fileContent;
    try {
      fileContent = await readFile(suspectFilePath);
    } catch (err) {
      console.log(`Failed to read file ${suspectFilePath}:`, err.message);
      return;
    }

    // 3. Generate Fix
    console.log('Generating fix...');
    const fixPrompt = `Given the following failing tests:\\n${failures}\\n\\nAnd the content of ${suspectFilePath}:\\n\`\`\`\\n${fileContent}\\n\`\`\`\\n\\nPlease provide the complete updated code for this file that fixes the issue. Return ONLY the raw code, without markdown blocks.`;

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

  } catch (err) {
    console.error('Agent workflow encountered an error:', err.response?.data || err.message);
  }
}

main();
