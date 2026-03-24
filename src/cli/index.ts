#!/usr/bin/env node
/**
 * Rainfall CLI - Command line interface for Rainfall API
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Rainfall } from '../sdk.js';

const CONFIG_DIR = join(homedir(), '.rainfall');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiKey?: string;
  baseUrl?: string;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
  
  me                            Show account info and usage
  
  config get [key]              Get configuration value
  config set <key> <value>      Set configuration value
  
  help                          Show this help message

Options for 'run':
  --params, -p <json>           Tool parameters as JSON
  --file, -f <path>             Read parameters from file
  --raw                         Output raw JSON

Examples:
  rainfall auth login
  rainfall tools list
  rainfall tools describe github-create-issue
  rainfall run exa-web-search -p '{"query": "AI news"}'
  rainfall run article-summarize -f ./article.json
  echo '{"query": "hello"}' | rainfall run exa-web-search
`);
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

  // Check for piped input
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    if (chunks.length > 0) {
      try {
        const piped = JSON.parse(Buffer.concat(chunks).toString());
        params = { ...params, ...piped };
      } catch {
        // Ignore invalid piped JSON
      }
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
    console.log(config[key as keyof Config] || '');
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
    process.exit(1);
  }

  const config = loadConfig();
  (config as Record<string, string>)[key] = value;
  saveConfig(config);
  console.log(`✓ Set ${key} = ${value}`);
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
      await runTool(rest);
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
        default:
          console.error('Error: Unknown config subcommand');
          console.error('\nUsage: rainfall config <get|set>');
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
