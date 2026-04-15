/**
 * In-memory + file-backed log store for the orchestration layer.
 * Stores test results, actions taken, and decisions.
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'data', 'logs.json');
const MAX_LOGS = 200;

// Ensure data directory exists
try {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
} catch {}

// ─── In-Memory State ──────────────────────────────────────────────────
let logs = [];
let latestTestResult = null;
let lastRunTimestamp = null;

// Load from disk on startup
try {
  if (fs.existsSync(LOG_FILE)) {
    const raw = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    logs = raw.logs || [];
    latestTestResult = raw.latestTestResult || null;
    lastRunTimestamp = raw.lastRunTimestamp || null;
    console.log(`[LogStore] Loaded ${logs.length} logs from disk.`);
  }
} catch (err) {
  console.log(`[LogStore] Could not load logs from disk: ${err.message}`);
}

// ─── Persist to disk ──────────────────────────────────────────────────
function persist() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify({
      logs: logs.slice(-MAX_LOGS),
      latestTestResult,
      lastRunTimestamp
    }, null, 2), 'utf8');
  } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────

function addLog(source, level, message, meta = {}) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substring(2, 8),
    timestamp: new Date().toISOString(),
    source,   // "mcp" | "agent" | "backend" | "orchestration"
    level,    // "info" | "warn" | "error" | "success"
    message,
    meta
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  persist();
  return entry;
}

function getLogs(count = 20, source = null) {
  let filtered = source ? logs.filter(l => l.source === source) : logs;
  return filtered.slice(-count);
}

function setLatestTestResult(result) {
  latestTestResult = result;
  lastRunTimestamp = new Date().toISOString();
  persist();
}

function getLatestTestResult() {
  return latestTestResult;
}

function getLastRunTimestamp() {
  return lastRunTimestamp;
}

module.exports = {
  addLog,
  getLogs,
  setLatestTestResult,
  getLatestTestResult,
  getLastRunTimestamp
};
