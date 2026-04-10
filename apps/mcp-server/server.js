const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(__dirname, '../../');

app.use(express.json());

// Run Playwright E2E tests
app.post('/run-tests', (req, res) => {
  exec('npx playwright test tests/crud.spec.js --reporter=json', (error, stdout, stderr) => {
    try {
      // Playwright outputs the JSON to stdout
      const report = JSON.parse(stdout);
      res.json({ success: !error, report, stdout, stderr });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to parse test report', stdout, stderr });
    }
  });
});

// Read file content
app.post('/read-file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  const absolutePath = path.resolve(WORKSPACE_DIR, filePath);
  
  if (!absolutePath.startsWith(WORKSPACE_DIR)) {
    return res.status(403).json({ error: 'Access denied outside workspace' });
  }

  fs.readFile(absolutePath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ content: data });
  });
});

// Apply a fix (Create branch, write file, commit, push)
app.post('/apply-fix', (req, res) => {
  const { filePath, content, commitMessage, branchName } = req.body;
  
  if (!filePath || !content || !commitMessage || !branchName) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const absolutePath = path.resolve(WORKSPACE_DIR, filePath);

  try {
    // 1. Write the new content to file
    fs.writeFileSync(absolutePath, content, 'utf8');

    // 2. Git operations
    const autoFixScript = `
      cd ${WORKSPACE_DIR}
      git checkout -b ${branchName}
      git add ${filePath}
      git commit -m "${commitMessage}"
      git push origin ${branchName}
    `;

    exec(autoFixScript, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: 'Git operation failed', stdout, stderr });
      }
      res.json({ success: true, stdout, stderr });
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP Server listening on port ${PORT}`);
});
