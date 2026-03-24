#!/usr/bin/env node
/**
 * Example: Connect Chrome DevTools MCP to Rainfall Daemon
 * 
 * This shows how to connect the Chrome DevTools MCP server to the Rainfall daemon
 * so that browser automation tools become available through the daemon.
 * 
 * Usage:
 *   1. Start the Rainfall daemon: rainfall daemon start
 *   2. In another terminal, run Chrome DevTools MCP with auto-connect:
 *      npx @chrome-devtools/mcp@latest --auto-connect
 *   3. Or use this script to connect programmatically
 */

import { RainfallDaemon } from '../dist/daemon/index.js';

async function main() {
  // Create daemon with MCP proxy enabled (default)
  const daemon = new RainfallDaemon({
    port: 8765,
    openaiPort: 8787,
    debug: true,
    enableMcpProxy: true,
    mcpNamespacePrefix: true, // Tools will be prefixed with client name (e.g., chrome-take_screenshot)
  });

  // Start the daemon
  await daemon.start();

  // Example: Connect Chrome DevTools MCP via stdio
  // This assumes @chrome-devtools/mcp is installed globally
  console.log('\n📎 To connect Chrome DevTools MCP, run:');
  console.log('   npx @chrome-devtools/mcp@latest --auto-connect');
  console.log('\n   Or connect programmatically via the API:');
  console.log('   POST http://localhost:8787/v1/mcp/connect');
  console.log('   Body: { "name": "chrome", "transport": "stdio", "command": "npx", "args": ["@chrome-devtools/mcp@latest"] }');

  // Example: Connect programmatically
  // await daemon.connectMCPClient({
  //   name: 'chrome',
  //   transport: 'stdio',
  //   command: 'npx',
  //   args: ['@chrome-devtools/mcp@latest'],
  // });

  // Keep the process alive
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await daemon.stop();
    process.exit(0);
  });
}

main().catch(console.error);
