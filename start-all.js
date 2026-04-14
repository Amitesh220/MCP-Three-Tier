const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');

console.log('Orchestrating local AI DevOps Pipeline...\\n');

// Keep track of spawned child processes to properly shut them down
const runningProcesses = [];

function startService(name, command, args, directory) {
  const absolutePath = path.resolve(__dirname, directory);
  
  const child = spawn(command, args, {
    cwd: absolutePath,
    shell: true,
    stdio: 'pipe'
  });

  const formatLog = (data, isError) => {
    data.toString().split('\\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed) {
        if (isError) console.error(`[${name}] ${trimmed}`);
        else console.log(`[${name}] ${trimmed}`);
      }
    });
  };

  child.stdout.on('data', (data) => formatLog(data, false));
  child.stderr.on('data', (data) => formatLog(data, true));

  child.on('close', (code) => {
    console.log(`[${name}] Process exited with code ${code || 0}`);
  });

  child.on('error', (err) => {
    console.error(`[${name}] Failed to start process: ${err.message}`);
  });

  runningProcesses.push(child);
  return child;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function openBrowser(url) {
  let openCmd = 'xdg-open'; // Linux default
  if (os.platform() === 'win32') {
    openCmd = 'start';
  } else if (os.platform() === 'darwin') {
    openCmd = 'open';
  }

  exec(`${openCmd} ${url}`, (err) => {
    if (err) {
      console.error(`[SYSTEM] Failed to automatically open browser: ${err.message}`);
    } else {
      console.log(`[SYSTEM] Successfully opened ${url}`);
    }
  });
}

function killProcess(p) {
  if (!p.killed) {
    if (os.platform() === 'win32') {
      exec(`taskkill /pid ${p.pid} /t /f`, () => {});
    } else {
      p.kill('SIGTERM');
      p.kill('SIGKILL');
    }
  }
}

async function main() {
  console.log('🚀 Starting Backend...');
  startService('BACKEND', 'npm', ['start'], 'apps/backend');
  
  await sleep(3000);
  
  console.log('🚀 Starting MCP Server...');
  startService('MCP', 'node', ['server.js'], 'apps/mcp-server');
  
  await sleep(3000);
  
  console.log('🚀 Starting Frontend...');
  startService('FRONTEND', 'npm', ['run', 'dev'], 'apps/frontend');

  await sleep(4000); // Give the bundler a minute to spin up
  console.log('🚀 Opening Frontend in browser default...');
  openBrowser('http://localhost:5173');

  console.log('\\n✅ All services running iteratively. Press Ctrl+C to stop them safely.\\n');

  const shutdown = () => {
    console.log('\\n🛑 Shutting down all services gracefully...');
    runningProcesses.forEach(killProcess);
    
    // Explicitly end after allowing kill signals to dispatch in tree
    setTimeout(() => {
      console.log('✅ Services shut down. Goodbye!');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error("Failed executing pipeline startup:", err);
});
