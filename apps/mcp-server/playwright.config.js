const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  timeout: 30000,        // 30s per test
  globalTimeout: 60000,  // 60s for entire suite
  use: {
    baseURL: process.env.FRONTEND_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    actionTimeout: 10000,
  },
});
