require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const os = require('os');
const axios = require('axios');
const logStore = require('./logStore');

const app = express();
const PORT = process.env.PORT || 7000;

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://mcp-server:4000';
const AGENT_URL = process.env.AGENT_URL || 'http://agent:3001';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://frontend:5173';

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────
// Helper: safely exec shell commands
// ─────────────────────────────────────────────────────────────────────────
function safeExec(command, timeoutMs = 10000) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' }).trim();
  } catch (err) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helper: check if a service is reachable
// ─────────────────────────────────────────────────────────────────────────
async function checkService(name, url, healthPath = '/') {
  try {
    const res = await axios.get(`${url}${healthPath}`, { timeout: 3000 });
    return { name, status: 'running', statusCode: res.status };
  } catch (err) {
    return { name, status: 'unreachable', error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  TASK 1 — SYSTEM INSTRUMENTATION APIs
// ═════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────
// GET /system/state — Full system state
// ──────────────────────────────────────
app.get('/system/state', async (req, res) => {
  console.log('[Orchestration] GET /system/state');
  logStore.addLog('orchestration', 'info', 'System state requested');

  // Check all services in parallel
  const [backendStatus, frontendStatus, mcpStatus] = await Promise.all([
    checkService('backend', BACKEND_URL, '/api/items'),
    checkService('frontend', FRONTEND_URL, '/'),
    checkService('mcp', MCP_SERVER_URL, '/health')
  ]);

  const state = {
    tests: logStore.getLatestTestResult(),
    status: {
      backend: backendStatus.status,
      frontend: frontendStatus.status,
      mcp: mcpStatus.status
    },
    services: [backendStatus, frontendStatus, mcpStatus],
    lastRun: logStore.getLastRunTimestamp()
  };

  res.json(state);
});

// ──────────────────────────────────────
// GET /system/logs — Recent system logs
// ──────────────────────────────────────
app.get('/system/logs', (req, res) => {
  const count = parseInt(req.query.count) || 20;
  const source = req.query.source || null; // Filter: "mcp", "agent", "backend", "orchestration"

  console.log(`[Orchestration] GET /system/logs (count=${count}, source=${source || 'all'})`);

  const logs = logStore.getLogs(count, source);
  res.json({ total: logs.length, logs });
});

// ──────────────────────────────────────
// GET /system/metrics — CPU, Memory, Containers
// ──────────────────────────────────────
app.get('/system/metrics', (req, res) => {
  console.log('[Orchestration] GET /system/metrics');

  // CPU usage
  const cpus = os.cpus();
  const cpuUsage = cpus.map(cpu => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return ((total - idle) / total * 100).toFixed(1);
  });
  const avgCpu = (cpuUsage.reduce((a, b) => a + parseFloat(b), 0) / cpuUsage.length).toFixed(1);

  // Memory usage
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Container list via docker ps
  let containers = [];
  const dockerPs = safeExec('docker ps --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Ports}}"');
  if (dockerPs) {
    containers = dockerPs.split('\n').filter(Boolean).map(line => {
      const [id, name, status, ports] = line.split('|');
      return { id, name, status, ports };
    });
  }

  // Container stats (lightweight — just names + CPU/Mem from docker stats --no-stream)
  let containerStats = [];
  const statsRaw = safeExec('docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"', 15000);
  if (statsRaw) {
    containerStats = statsRaw.split('\n').filter(Boolean).map(line => {
      const [name, cpu, mem] = line.split('|');
      return { name, cpu, mem };
    });
  }

  res.json({
    cpu: {
      cores: cpus.length,
      avgPercent: parseFloat(avgCpu),
      perCore: cpuUsage.map(Number)
    },
    memory: {
      totalMB: Math.round(totalMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
      usedPercent: parseFloat(((usedMem / totalMem) * 100).toFixed(1))
    },
    containers,
    containerStats
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  TASK 2 — ACTION TRIGGER APIs
// ═════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────
// POST /action/run-tests — Trigger MCP test execution
// ──────────────────────────────────────
app.post('/action/run-tests', async (req, res) => {
  console.log('[Orchestration] POST /action/run-tests');
  logStore.addLog('orchestration', 'info', 'Manual test run triggered');

  try {
    const result = await axios.post(`${MCP_SERVER_URL}/run-tests`, {}, { timeout: 180000 });
    logStore.setLatestTestResult(result.data);
    logStore.addLog('mcp', result.data.success ? 'success' : 'error',
      `Tests ${result.data.success ? 'passed' : 'failed'}: ${result.data.failures?.length || 0} failure(s)`,
      { failureCount: result.data.failures?.length || 0 }
    );
    res.json({ triggered: true, result: result.data });
  } catch (err) {
    logStore.addLog('mcp', 'error', `Test trigger failed: ${err.message}`);
    res.status(500).json({ triggered: false, error: err.message });
  }
});

// ──────────────────────────────────────
// POST /action/fix — Trigger the AI agent fix pipeline
// ──────────────────────────────────────
app.post('/action/fix', async (req, res) => {
  console.log('[Orchestration] POST /action/fix');
  logStore.addLog('orchestration', 'info', 'Manual fix pipeline triggered');

  try {
    // The agent runs as a continuous loop; to trigger an immediate cycle,
    // we call MCP tests first, then proxy the result to the agent webhook (if available).
    // For now, we trigger an on-demand test + triage sequence through MCP.
    const testResult = await axios.post(`${MCP_SERVER_URL}/run-tests`, {}, { timeout: 180000 });
    logStore.setLatestTestResult(testResult.data);

    if (!testResult.data.success && testResult.data.failures?.length > 0) {
      logStore.addLog('agent', 'info', `Fix triggered: ${testResult.data.failures.length} failure(s) detected`);
      res.json({
        triggered: true,
        message: `${testResult.data.failures.length} failure(s) found. Agent will pick up in next cycle.`,
        failures: testResult.data.failures
      });
    } else {
      logStore.addLog('agent', 'success', 'All tests passed — no fix needed');
      res.json({ triggered: false, message: 'All tests passing. No fix needed.' });
    }
  } catch (err) {
    logStore.addLog('agent', 'error', `Fix trigger failed: ${err.message}`);
    res.status(500).json({ triggered: false, error: err.message });
  }
});

// ──────────────────────────────────────
// POST /action/restart — Restart a specific container
// ──────────────────────────────────────
app.post('/action/restart', (req, res) => {
  const { service } = req.body;
  const allowed = ['backend', 'frontend', 'mcp-server', 'agent'];

  if (!service || !allowed.includes(service)) {
    return res.status(400).json({
      error: `Invalid service. Must be one of: ${allowed.join(', ')}`,
      allowed
    });
  }

  console.log(`[Orchestration] POST /action/restart → ${service}`);
  logStore.addLog('orchestration', 'warn', `Restarting service: ${service}`);

  try {
    const output = safeExec(`docker restart ${service}`, 30000);
    logStore.addLog('orchestration', 'success', `Service ${service} restarted`);
    res.json({ restarted: true, service, output });
  } catch (err) {
    logStore.addLog('orchestration', 'error', `Failed to restart ${service}: ${err.message}`);
    res.status(500).json({ restarted: false, error: err.message });
  }
});

// ──────────────────────────────────────
// POST /action/deploy — Full redeploy via docker-compose
// ──────────────────────────────────────
app.post('/action/deploy', (req, res) => {
  console.log('[Orchestration] POST /action/deploy');
  logStore.addLog('orchestration', 'warn', 'Full redeploy triggered');

  try {
    const output = safeExec('docker compose -f /workspace/docker-compose.yml up -d --build', 120000);
    logStore.addLog('orchestration', 'success', 'Redeploy completed');
    res.json({ deployed: true, output });
  } catch (err) {
    logStore.addLog('orchestration', 'error', `Redeploy failed: ${err.message}`);
    res.status(500).json({ deployed: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════
//  TASK 3 — LOG INGESTION ENDPOINT (for other services to push logs)
// ═════════════════════════════════════════════════════════════════════════

app.post('/logs/ingest', (req, res) => {
  const { source, level, message, meta } = req.body;
  if (!source || !message) {
    return res.status(400).json({ error: 'source and message are required' });
  }
  const entry = logStore.addLog(source, level || 'info', message, meta || {});
  res.json({ stored: true, entry });
});

// ═════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═════════════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'orchestration-api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  START SERVER
// ═════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`\n[Orchestration] ════════════════════════════════════════`);
  console.log(`[Orchestration] 🎛️  Orchestration API running on port ${PORT}`);
  console.log(`[Orchestration] ════════════════════════════════════════\n`);
  logStore.addLog('orchestration', 'info', `Orchestration API started on port ${PORT}`);
});
