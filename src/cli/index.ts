#!/usr/bin/env node
/**
 * Rainfall CLI - Command line interface for Rainfall API
 */

import { readFileSync, existsSync } from 'fs';
import { Rainfall } from '../sdk.js';
import { loadConfig, saveConfig } from './config.js';

function printHelp(): void {
  console.log(`
Rainfall CLI - 200+ tools, one key

Usage:
  rainfall <command> [options]

Commands:
  auth login                    Store API key
  auth logout                   Remove stored API key
  auth status                   Check authentication status
  
  tools list                    List all available tools
  tools describe <tool>         Show tool schema and description
  tools search <query>          Search for tools
  
  run <tool> [options]          Execute a tool

  daemon start                  Start the Rainfall daemon
  daemon stop                   Stop the Rainfall daemon
  daemon restart                Restart the Rainfall daemon
  daemon status                 Check daemon status
  
  workflow new                  Create a new workflow (interactive)
  workflow run <workflow>       Run a saved workflow
  
  me                            Show account info and usage
  
  config get [key]              Get configuration value
  config set <key> <value>      Set configuration value
  config llm                    Show LLM configuration
  
  help                          Show this help message

Configuration keys:
  llm.provider                  LLM provider (rainfall|openai|anthropic|ollama|local)
  llm.baseUrl                   Base URL for the LLM API
  llm.apiKey                    API key for the LLM provider
  llm.model                     Default model to use

Options for 'run':
  --params, -p <json>           Tool parameters as JSON
  --file, -f <path>             Read parameters from file
  --raw                         Output raw JSON

Options for 'daemon start':
  --port <port>                 WebSocket port (default: 8765)
  --openai-port <port>          OpenAI API port (default: 8787)
  --debug                       Enable verbose debug logging

Examples:
  rainfall auth login
  rainfall tools list
  rainfall tools describe github-create-issue
  rainfall run exa-web-search -p '{"query": "AI news"}'
  rainfall run article-summarize -f ./article.json
  rainfall daemon start
  echo '{"query": "hello"}' | rainfall run exa-web-search
`);
}

function getRainfall(): Rainfall {
  const config = loadConfig();
  if (!config.apiKey) {
    console.error('Error: No API key configured. Run: rainfall auth login');
    process.exit(1);
  }
  return new Rainfall({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

async function authLogin(args: string[]): Promise<void> {
  const apiKey = args[0] || process.env.RAINFALL_API_KEY;
  
  if (!apiKey) {
    console.error('Error: API key required. Provide as argument or set RAINFALL_API_KEY environment variable.');
    console.error('\nUsage: rainfall auth login <api-key>');
    process.exit(1);
  }

  // Validate the key
  try {
    const rainfall = new Rainfall({ apiKey });
    const me = await rainfall.getMe();
    
    saveConfig({ apiKey });
    console.log(`✓ Authenticated as ${me.name || me.email || 'Unknown'}`);
    console.log(`  Plan: ${me.billingStatus || me.plan || 'N/A'}`);
    console.log(`  Usage: ${me.usage?.callsThisMonth?.toLocaleString() || 0} / ${me.usage?.callsLimit?.toLocaleString() || 'Unlimited'} calls this month`);
  } catch (error) {
    console.error('Error: Invalid API key');
    process.exit(1);
  }
}

function authLogout(): void {
  saveConfig({});
  console.log('✓ Logged out');
}

async function authStatus(): Promise<void> {
  const config = loadConfig();
  
  if (!config.apiKey) {
    console.log('Not authenticated');
    console.log('Run: rainfall auth login <api-key>');
    return;
  }

  try {
    const rainfall = new Rainfall({ apiKey: config.apiKey });
    const me = await rainfall.getMe();
    console.log(`Authenticated as ${me.name || me.email || 'Unknown'}`);
    console.log(`Plan: ${me.billingStatus || me.plan || 'N/A'}`);
    console.log(`Usage: ${me.usage?.callsThisMonth?.toLocaleString() || 0} / ${me.usage?.callsLimit?.toLocaleString() || 'Unlimited'} calls this month`);
  } catch (error) {
    console.log('Authentication expired or invalid');
    console.log('Run: rainfall auth login <api-key>');
  }
}

async function listTools(): Promise<void> {
  const rainfall = getRainfall();
  const tools = await rainfall.listTools();
  
  // Group by category
  const byCategory = new Map<string, typeof tools>();
  for (const tool of tools) {
    const category = tool.category || 'uncategorized';
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(tool);
  }

  console.log(`Available tools (${tools.length} total):\n`);
  
  for (const [category, categoryTools] of byCategory) {
    console.log(`${category}:`);
    for (const tool of categoryTools) {
      console.log(`  ${tool.id.padEnd(30)} ${tool.description.slice(0, 50)}${tool.description.length > 50 ? '...' : ''}`);
    }
    console.log();
  }
}

interface SchemaProperty {
  type?: string;
  description?: string;
  optional?: boolean;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

function formatSchema(obj: unknown, indent = 0): string {
  if (!obj || typeof obj !== 'object') return String(obj);
  
  const lines: string[] = [];
  const pad = '  '.repeat(indent);
  
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') {
      const prop = value as SchemaProperty;
      const type = prop.type || 'object';
      const optional = prop.optional ? ' (optional)' : '';
      const desc = prop.description ? ` - ${prop.description}` : '';
      
      lines.push(`${pad}• ${key}${optional}: ${type}${desc}`);
      
      // Recurse into nested properties
      if (prop.properties) {
        lines.push(formatSchema(prop.properties, indent + 1));
      }
      // Show array item structure
      if (prop.items && prop.items.properties) {
        lines.push(`${pad}  items:`);
        lines.push(formatSchema(prop.items.properties, indent + 2));
      }
    } else {
      lines.push(`${pad}• ${key}: ${value}`);
    }
  }
  
  return lines.join('\n');
}

async function describeTool(args: string[]): Promise<void> {
  const toolId = args[0];
  
  if (!toolId) {
    console.error('Error: Tool ID required');
    console.error('\nUsage: rainfall tools describe <tool-id>');
    process.exit(1);
  }

  const rainfall = getRainfall();
  
  try {
    const schema = await rainfall.getToolSchema(toolId);
    console.log(`\n  ${schema.name}`);
    console.log(`  ${'─'.repeat(Math.max(schema.name.length, 40))}`);
    console.log(`\n  Description:`);
    console.log(`    ${schema.description.split('\n').join('\n    ')}`);
    console.log(`\n  Category: ${schema.category}`);
    
    console.log(`\n  Parameters:`);
    if (schema.parameters && typeof schema.parameters === 'object' && Object.keys(schema.parameters).length > 0) {
      console.log(formatSchema(schema.parameters, 2));
    } else {
      console.log('    None');
    }
    
    console.log(`\n  Output:`);
    if (schema.output && typeof schema.output === 'object' && Object.keys(schema.output).length > 0) {
      console.log(formatSchema(schema.output, 2));
    } else {
      console.log('    None');
    }
    console.log();
  } catch (error) {
    console.error(`Error: Tool '${toolId}' not found`);
    process.exit(1);
  }
}

async function searchTools(args: string[]): Promise<void> {
  const query = args[0];
  
  if (!query) {
    console.error('Error: Search query required');
    console.error('\nUsage: rainfall tools search <query>');
    process.exit(1);
  }

  const rainfall = getRainfall();
  const tools = await rainfall.listTools();
  
  const lowerQuery = query.toLowerCase();
  const matches = tools.filter(t => 
    t.id.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery) ||
    t.category.toLowerCase().includes(lowerQuery)
  );

  if (matches.length === 0) {
    console.log(`No tools found matching '${query}'`);
    return;
  }

  console.log(`Found ${matches.length} tool(s) matching '${query}':\n`);
  for (const tool of matches) {
    console.log(`  ${tool.id.padEnd(30)} ${tool.description.slice(0, 50)}${tool.description.length > 50 ? '...' : ''}`);
  }
}

async function runTool(args: string[]): Promise<void> {
  const toolId = args[0];
  
  if (!toolId) {
    console.error('Error: Tool ID required');
    console.error('\nUsage: rainfall run <tool-id> [options]');
    process.exit(1);
  }

  // Check for help flag
  if (toolId === '--help' || toolId === '-h') {
    console.log(`
Usage: rainfall run <tool-id> [options]

Execute a tool by ID.

Options:
  -p, --params <json>    Tool parameters as JSON string
  -f, --file <path>      Read parameters from JSON file
  --raw                  Output raw JSON (no formatting)

Examples:
  rainfall run figma-users-getMe
  rainfall run exa-web-search -p '{"query": "AI news"}'
  rainfall run github-create-issue -f ./issue.json
  echo '{"query": "hello"}' | rainfall run exa-web-search
`);
    return;
  }

  let params: Record<string, unknown> = {};

  // Parse options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--params' || arg === '-p') {
      const json = args[++i];
      if (!json) {
        console.error('Error: --params requires a JSON string');
        process.exit(1);
      }
      try {
        params = JSON.parse(json);
      } catch {
        console.error('Error: Invalid JSON for --params');
        process.exit(1);
      }
    } else if (arg === '--file' || arg === '-f') {
      const filePath = args[++i];
      if (!filePath) {
        console.error('Error: --file requires a file path');
        process.exit(1);
      }
      try {
        params = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        console.error(`Error: Could not read or parse file: ${filePath}`);
        process.exit(1);
      }
    } else if (arg === '--raw') {
      // Output format flag, handled later
    }
  }

  // Check for piped input (only if stdin is not a TTY)
  // We use a non-blocking approach to avoid hanging when there's no piped input
  if (!process.stdin.isTTY) {
    // Pause stdin to prevent it from keeping the process alive
    process.stdin.pause();
    
    // Check if there's any data available
    const fs = await import('fs');
    try {
      // Use fs.read with a timeout to check for data
      const buffer = Buffer.alloc(1024);
      const bytesRead = await new Promise<number>((resolve) => {
        const timeout = setTimeout(() => resolve(0), 50);
        fs.read(process.stdin.fd, buffer, 0, 1024, null, (err, n) => {
          clearTimeout(timeout);
          resolve(err ? 0 : n);
        });
      });
      
      if (bytesRead > 0) {
        let data = buffer.toString('utf8', 0, bytesRead);
        
        // Try to read more if available
        while (true) {
          const more = await new Promise<number>((resolve) => {
            fs.read(process.stdin.fd, buffer, 0, 1024, null, (err, n) => {
              resolve(err ? 0 : n);
            });
          });
          if (more === 0) break;
          data += buffer.toString('utf8', 0, more);
        }
        
        if (data.trim()) {
          try {
            const piped = JSON.parse(data);
            params = { ...params, ...piped };
          } catch {
            // Ignore invalid piped JSON
          }
        }
      }
    } catch {
      // Error reading stdin - ignore
    }
  }

  const rainfall = getRainfall();
  
  try {
    const result = await rainfall.executeTool(toolId, params);
    
    if (args.includes('--raw')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function showMe(): Promise<void> {
  const rainfall = getRainfall();
  const me = await rainfall.getMe();
  
  console.log(`Account: ${me.email}`);
  console.log(`ID: ${me.id}`);
  console.log(`Plan: ${me.plan}`);
  console.log(`Usage: ${me.usage.callsThisMonth.toLocaleString()} / ${me.usage.callsLimit.toLocaleString()} calls this month`);
  console.log(`Remaining: ${(me.usage.callsLimit - me.usage.callsThisMonth).toLocaleString()} calls`);
}

function configGet(args: string[]): void {
  const key = args[0];
  const config = loadConfig();
  
  if (key) {
    // Support nested keys like "llm.provider"
    const parts = key.split('.');
    let value: unknown = config;
    for (const part of parts) {
      value = (value as Record<string, unknown>)?.[part];
    }
    if (typeof value === 'object' && value !== null) {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(value ?? '');
    }
  } else {
    console.log(JSON.stringify(config, null, 2));
  }
}

function configSet(args: string[]): void {
  const key = args[0];
  const value = args[1];
  
  if (!key || !value) {
    console.error('Error: Both key and value required');
    console.error('\nUsage: rainfall config set <key> <value>');
    console.error('\nExamples:');
    console.error('  rainfall config set llm.provider local');
    console.error('  rainfall config set llm.baseUrl http://localhost:1234/v1');
    console.error('  rainfall config set llm.model llama-3.3-70b-versatile');
    process.exit(1);
  }

  const config = loadConfig();
  
  // Support nested keys like "llm.provider"
  const parts = key.split('.');
  if (parts.length === 1) {
    (config as Record<string, unknown>)[key] = value;
  } else {
    let target: Record<string, unknown> = config as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
        target[parts[i]] = {};
      }
      target = target[parts[i]] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = value;
  }
  
  saveConfig(config);
  console.log(`✓ Set ${key} = ${value}`);
}

function configLLM(): void {
  const config = loadConfig();
  const llm = config.llm || { provider: 'rainfall' };
  
  console.log('LLM Configuration:');
  console.log(`  Provider: ${llm.provider}`);
  console.log(`  Base URL: ${llm.baseUrl || '(default)'}`);
  console.log(`  Model: ${llm.model || '(default)'}`);
  console.log(`  API Key: ${llm.apiKey ? '****' + llm.apiKey.slice(-4) : '(none)'}`);
  console.log();
  console.log('Providers:');
  console.log('  rainfall  - Use Rainfall backend (default, uses your credits)');
  console.log('  openai    - Use OpenAI API directly');
  console.log('  anthropic - Use Anthropic API directly');
  console.log('  ollama    - Use local Ollama instance');
  console.log('  local     - Use any OpenAI-compatible endpoint (LM Studio, etc.)');
  console.log();
  console.log('Examples:');
  console.log('  rainfall config set llm.provider local');
  console.log('  rainfall config set llm.baseUrl http://localhost:1234/v1');
  console.log('  rainfall config set llm.provider openai');
  console.log('  rainfall config set llm.apiKey sk-...');
}

// Daemon commands
async function daemonStart(args: string[]): Promise<void> {
  // Parse options
  let port: number | undefined;
  let openaiPort: number | undefined;
  let debug = false;

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
    }
  }

  const { startDaemon } = await import('../daemon/index.js');
  
  try {
    await startDaemon({ port, openaiPort, debug });
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n');
      const { stopDaemon } = await import('../daemon/index.js');
      await stopDaemon();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      const { stopDaemon } = await import('../daemon/index.js');
      await stopDaemon();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start daemon:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function daemonStop(): Promise<void> {
  const { stopDaemon } = await import('../daemon/index.js');
  await stopDaemon();
}

async function daemonRestart(args: string[]): Promise<void> {
  const { stopDaemon, startDaemon } = await import('../daemon/index.js');
  
  // Parse options
  let port: number | undefined;
  let openaiPort: number | undefined;
  let debug = false;

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
    }
  }

  console.log('🔄 Restarting daemon...');
  
  try {
    await stopDaemon();
    // Small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    await startDaemon({ port, openaiPort, debug });
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n');
      const { stopDaemon: stop } = await import('../daemon/index.js');
      await stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      const { stopDaemon: stop } = await import('../daemon/index.js');
      await stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to restart daemon:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function daemonStatus(): Promise<void> {
  const { getDaemonStatus } = await import('../daemon/index.js');
  const status = getDaemonStatus();
  
  if (!status) {
    console.log('Daemon not running');
    console.log('Run: rainfall daemon start');
    return;
  }
  
  console.log('Daemon status:');
  console.log(`  Running: ${status.running ? 'yes' : 'no'}`);
  console.log(`  WebSocket port: ${status.port}`);
  console.log(`  OpenAI API port: ${status.openaiPort}`);
  console.log(`  Tools loaded: ${status.toolsLoaded}`);
  console.log(`  Clients connected: ${status.clientsConnected}`);
  console.log(`  Edge Node ID: ${status.edgeNodeId || 'local'}`);
  console.log();
  console.log('Context:');
  console.log(`  Memories cached: ${status.context.memoriesCached}`);
  console.log(`  Active sessions: ${status.context.activeSessions}`);
  console.log(`  Current session: ${status.context.currentSession || 'none'}`);
  console.log(`  Execution history: ${status.context.executionHistorySize}`);
  console.log();
  console.log('Listeners:');
  console.log(`  File watchers: ${status.listeners.fileWatchers}`);
  console.log(`  Cron triggers: ${status.listeners.cronTriggers}`);
  console.log(`  Recent events: ${status.listeners.recentEvents}`);
}

// Workflow commands
async function workflowNew(): Promise<void> {
  console.log('🚧 Interactive workflow creation coming soon!');
  console.log();
  console.log('For now, create workflows using the SDK:');
  console.log('  import { createFileWatcherWorkflow } from "@rainfall-devkit/sdk/daemon";');
  console.log();
  console.log('Example:');
  console.log(`  const workflow = createFileWatcherWorkflow('pdf-processor', '~/Downloads', {`);
  console.log(`    pattern: '*.pdf',`);
  console.log(`    events: ['create'],`);
  console.log(`    workflow: [`);
  console.log(`      { toolId: 'ocr-pdf', params: {} },`);
  console.log(`      { toolId: 'notion-create-page', params: { parent: '...' } },`);
  console.log(`    ],`);
  console.log(`  });`);
}

async function workflowRun(args: string[]): Promise<void> {
  const workflowId = args[0];
  
  if (!workflowId) {
    console.error('Error: Workflow ID required');
    console.error('\nUsage: rainfall workflow run <workflow-id>');
    process.exit(1);
  }
  
  console.log(`🚧 Running workflow: ${workflowId}`);
  console.log('Workflow execution coming soon!');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];
  const rest = args.slice(2);

  switch (command) {
    case 'auth':
      switch (subcommand) {
        case 'login':
          await authLogin(rest);
          break;
        case 'logout':
          authLogout();
          break;
        case 'status':
          await authStatus();
          break;
        default:
          console.error('Error: Unknown auth subcommand');
          console.error('\nUsage: rainfall auth <login|logout|status>');
          process.exit(1);
      }
      break;

    case 'tools':
      switch (subcommand) {
        case 'list':
          await listTools();
          break;
        case 'describe':
          await describeTool(rest);
          break;
        case 'search':
          await searchTools(rest);
          break;
        default:
          console.error('Error: Unknown tools subcommand');
          console.error('\nUsage: rainfall tools <list|describe|search>');
          process.exit(1);
      }
      break;

    case 'run':
      await runTool(args.slice(1));
      break;

    case 'daemon':
      switch (subcommand) {
        case 'start':
          await daemonStart(rest);
          break;
        case 'stop':
          await daemonStop();
          break;
        case 'restart':
          await daemonRestart(rest);
          break;
        case 'status':
          await daemonStatus();
          break;
        default:
          console.error('Error: Unknown daemon subcommand');
          console.error('\nUsage: rainfall daemon <start|stop|restart|status>');
          process.exit(1);
      }
      break;

    case 'workflow':
      switch (subcommand) {
        case 'new':
          await workflowNew();
          break;
        case 'run':
          await workflowRun(rest);
          break;
        default:
          console.error('Error: Unknown workflow subcommand');
          console.error('\nUsage: rainfall workflow <new|run>');
          process.exit(1);
      }
      break;

    case 'me':
      await showMe();
      break;

    case 'config':
      switch (subcommand) {
        case 'get':
          configGet(rest);
          break;
        case 'set':
          configSet(rest);
          break;
        case 'llm':
          configLLM();
          break;
        default:
          console.error('Error: Unknown config subcommand');
          console.error('\nUsage: rainfall config <get|set|llm>');
          process.exit(1);
      }
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;

    default:
      console.error(`Error: Unknown command '${command}'`);
      console.error('\nRun `rainfall help` for usage information.');
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
