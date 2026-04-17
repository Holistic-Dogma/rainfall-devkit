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
  
  // Get API key from environment
  const apiKey = process.env.RAINFALL_API_KEY;
  console.log(`[sidecar] API key from environment: ${apiKey ? `YES (length: ${apiKey.length})` : 'NO'}`);
  
  // Collect provider API keys from environment
  // Format: PROVIDER_API_KEY_{PROVIDER_ID}={API_KEY}
  const providerApiKeys: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PROVIDER_API_KEY_') && value) {
      const providerId = key.replace('PROVIDER_API_KEY_', '').toLowerCase().replace(/_/g, '-');
      providerApiKeys[providerId] = value;
      console.log(`[sidecar] Found API key for provider: ${providerId} (length: ${value.length})`);
    }
  }
  if (Object.keys(providerApiKeys).length > 0) {
    console.log(`[sidecar] Total provider API keys: ${Object.keys(providerApiKeys).length}`);
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
    const daemon = await startDaemon({ 
      port, 
      openaiPort, 
      debug, 
      enableMcpProxy,
      rainfallConfig: apiKey ? { apiKey } : undefined,
      providerApiKeys: Object.keys(providerApiKeys).length > 0 ? providerApiKeys : undefined
    });
    console.log(`[sidecar] ✅ Daemon ready - WebSocket: ${port || 8765}, OpenAI proxy: ${openaiPort || 8787}`);
    
    // Keep the process alive
    await new Promise(() => {});
  } catch (error) {
    console.error('[sidecar] Failed to start daemon:', error);
    process.exit(1);
  }
}

main();
