#!/usr/bin/env node
/**
 * Rainfall Daemon Sidecar Entry Point
 * 
 * This is a minimal wrapper that immediately starts the daemon.
 * Designed to be compiled with `bun build --compile` for use as a Tauri sidecar.
 * 
 * Usage:
 *   ./rainfall-daemon-sidecar [options]
 * 
 * Options (via env vars or CLI args):
 *   --port <port>          WebSocket port (default: 8765, env: RAINFALL_PORT)
 *   --openai-port <port>   OpenAI proxy port (default: 8787, env: RAINFALL_OPENAI_PORT)
 *   --debug                Enable debug logging (env: RAINFALL_DEBUG)
 *   --no-mcp-proxy         Disable MCP proxy hub
 */

import { startDaemon, stopDaemon } from './index.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse CLI args
  let port: number | undefined;
  let openaiPort: number | undefined;
  let debug = process.env.RAINFALL_DEBUG === '1' || process.env.RAINFALL_DEBUG === 'true';
  let enableMcpProxy = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port') {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) port = val;
    } else if (arg === '--openai-port') {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) openaiPort = val;
    } else if (arg === '--debug') {
      debug = true;
    } else if (arg === '--no-mcp-proxy') {
      enableMcpProxy = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Rainfall Daemon Sidecar

Usage: rainfall-daemon-sidecar [options]

Options:
  --port <port>         WebSocket port (default: 8765, env: RAINFALL_PORT)
  --openai-port <port>  OpenAI proxy port (default: 8787, env: RAINFALL_OPENAI_PORT)
  --debug               Enable debug logging (env: RAINFALL_DEBUG)
  --no-mcp-proxy        Disable MCP proxy hub
  --help, -h            Show this help

Environment variables override CLI arguments.
`);
      process.exit(0);
    }
  }

  // Environment variable overrides
  if (process.env.RAINFALL_PORT) {
    const envPort = parseInt(process.env.RAINFALL_PORT, 10);
    if (!isNaN(envPort)) port = envPort;
  }
  if (process.env.RAINFALL_OPENAI_PORT) {
    const envPort = parseInt(process.env.RAINFALL_OPENAI_PORT, 10);
    if (!isNaN(envPort)) openaiPort = envPort;
  }

  // Handle signals for graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[sidecar] SIGINT received, shutting down...');
    await stopDaemon();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[sidecar] SIGTERM received, shutting down...');
    await stopDaemon();
    process.exit(0);
  });

  // Start the daemon
  try {
    console.log('[sidecar] Starting Rainfall daemon...');
    const daemon = await startDaemon({ port, openaiPort, debug, enableMcpProxy });
    console.log(`[sidecar] Daemon ready - WebSocket: ${port || 8765}, OpenAI proxy: ${openaiPort || 8787}`);
    
    // Keep the process alive
    await new Promise(() => {});
  } catch (error) {
    console.error('[sidecar] Failed to start daemon:', error);
    process.exit(1);
  }
}

main();
