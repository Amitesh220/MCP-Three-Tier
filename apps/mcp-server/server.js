require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || process.env.MCP_SERVER_PORT || 4000;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(__dirname, '../../');

app.use(express.json());

/**
 * Heuristically classify a test failure into UI | API | LOGIC
 * based on error message content.
 */
function classifyFailureType(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();

  // API-related patterns
  if (
    msg.includes('api') ||
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('status') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('500') ||
    msg.includes('404') ||
    msg.includes('cors') ||
    msg.includes('request failed')
  ) {
    return 'API';
  }

  // UI-related patterns
  if (
    msg.includes('locator') ||
    msg.includes('selector') ||
    msg.includes('visible') ||
    msg.includes('click') ||
    msg.includes('element') ||
    msg.includes('not found') ||
    msg.includes('modal') ||
    msg.includes('button') ||
    msg.includes('text=') ||
    msg.includes('css') ||
    msg.includes('style') ||
    msg.includes('layout')
  ) {
    return 'UI';
  }

  // Everything else is likely business logic
  return 'LOGIC';
}

/**
 * Extract failures from the Playwright JSON report structure.
 * Playwright JSON shape: { suites: [{ specs: [{ title, tests: [{ results: [{ status, error }] }] }] }] }
 */
function extractFailures(report) {
  const failures = [];

  if (!report || !report.suites) return failures;

  for (const suite of report.suites) {
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (spec.tests) {
          for (const test of spec.tests) {
            if (test.results) {
              for (const result of test.results) {
                if (result.status !== 'passed' && result.status !== 'skipped') {
                  const errorMsg = result.error?.message || result.error?.snippet || 'Unknown error';
                  const errorStack = result.error?.stack || '';
                  failures.push({
                    test: spec.title || 'Unknown test',
                    error: errorMsg,
                    logs: errorStack,
                    type: classifyFailureType(errorMsg + ' ' + errorStack)
                  });
                }
              }
            }
          }
        }
      }
    }

    // Recurse into nested suites
    if (suite.suites) {
      const nested = extractFailures({ suites: suite.suites });
      failures.push(...nested);
    }
  }

  return failures;
}

// Run Playwright E2E tests
app.post('/run-tests', (req, res) => {
  console.log('[MCP] Tests started...');

  const cmd = 'npx playwright test --reporter=json';
  const opts = {
    cwd: __dirname,
    timeout: 120000, // 2 minute timeout for Playwright
    env: { ...process.env }
  };

  exec(cmd, opts, (error, stdout, stderr) => {
    console.log('[MCP] Tests completed.');

    try {
      // Playwright JSON reporter outputs to stdout
      const report = JSON.parse(stdout);
      const failures = extractFailures(report);
      const success = failures.length === 0;

      console.log(`[MCP] Result: ${success ? 'ALL PASSED' : `${failures.length} failure(s) detected`}`);

      res.json({ success, failures });
    } catch (parseErr) {
      console.error('[MCP] Failed to parse Playwright JSON output.');
      console.error('[MCP] stdout:', stdout?.substring(0, 500));
      console.error('[MCP] stderr:', stderr?.substring(0, 500));

      // Even on parse failure, return structured JSON
      res.json({
        success: false,
        failures: [{
          test: 'Playwright execution',
          error: `Test runner failed: ${error?.message || 'Unknown error'}`,
          logs: stderr || stdout || '',
          type: 'API'
        }]
      });
    }
  });
});

// Read file content
app.post('/read-file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  // Force base directory to ALWAYS be "/workspace"
  const baseDir = "/workspace";
  
  // Safe resolution: strip leading slash from filePath to prevent path.resolve from escaping the root
  const safeFilePath = filePath.replace(/^\/+/, '');
  const absolutePath = path.resolve(baseDir, safeFilePath);

  console.log("BaseDir:", baseDir);
  console.log("Requested:", filePath);
  console.log("Resolved:", absolutePath);

  // Security: prevent path traversal outside workspace
  if (!absolutePath.startsWith(baseDir)) {
    console.error(`[MCP]   ❌ Access denied: path escapes workspace`);
    return res.status(403).json({ error: 'Access denied outside workspace' });
  }

  // Check file exists before reading
  if (!fs.existsSync(absolutePath)) {
    console.error(`[MCP]   ❌ File not found: ${absolutePath}`);
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    console.log(`[MCP]   ✅ File read successfully (${content.length} chars)`);
    res.json({ content });
  } catch (err) {
    console.error(`[MCP]   ❌ Error reading file: ${err.message}`);
    res.status(500).json({ error: `Failed to read file: ${err.message}` });
  }
});

// Apply a fix — write file only (git operations handled by agent)
app.post('/apply-fix', (req, res) => {
  const { filePath, content } = req.body;

  if (!filePath || !content) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }

  // Force base directory to ALWAYS be "/workspace"
  const baseDir = "/workspace";
  
  // Safe resolution: strip leading slash from filePath to prevent path.resolve from escaping the root
  const safeFilePath = filePath.replace(/^\/+/, '');
  const absolutePath = path.resolve(baseDir, safeFilePath);

  console.log("BaseDir:", baseDir);
  console.log("Requested:", filePath);
  console.log("Resolved:", absolutePath);

  if (!absolutePath.startsWith(baseDir)) {
    return res.status(403).json({ error: 'Access denied outside workspace' });
  }

  try {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    console.log(`[MCP] File written: ${filePath}`);
    res.json({ success: true, message: `File ${filePath} updated successfully` });
  } catch (err) {
    console.error(`[MCP] Failed to write file ${filePath}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint for service readiness
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[MCP] Server listening on port ${PORT}`);
});
