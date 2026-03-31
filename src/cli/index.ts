#!/usr/bin/env node
/**
 * Rainfall CLI - Command line interface for Rainfall API
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Rainfall } from '../sdk.js';
import { loadConfig, saveConfig, getConfigDir } from './config.js';
import { spawn } from 'child_process';
import { createEdgeNodeSecurity, type KeyPair } from '../security/edge-node.js';
import { parseCliArgs, formatValueForDisplay } from './core/param-parser.js';
import { formatResult, DisplayMode } from './core/display.js';
import { globalHandlerRegistry } from './handlers/_registry.js';
import type { ToolContext, PostflightContext } from './core/types.js';
import { exposeFunction } from './edge/expose-function.js';

function printHelp(): void {
  console.log(`
Rainfall CLI - 200+ tools, one key

Usage:
  rainfall <command> [options]

Commands:
  auth login                    Store API key
  auth logout                   Remove stored API key
  auth status                   Check authentication status
  auth google                   Authenticate with Google (Drive, Sheets, Docs)
  auth google --gmail           Authenticate with Google (includes Gmail access)
  auth google-logout            Remove Google authentication
  
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
  
  edge generate-keys            Generate key pair for edge node encryption
  edge register <proc-node-id>  Register a proc node for edge execution
  edge expose-function          Expose a local function as an edge node tool
  edge status                   Show edge node security status
  
  todos init                    Initialize todo list access (mints token)
  todos init --show-token       Initialize and display token for sharing
  todos token                   Show existing todo token
  todos list                    Show your todo list
  todos add <title>             Add a new todo item
  todos check <id>              Mark todo as completed
  todos uncheck <id>            Mark todo as not completed
  todos rm <id>                 Remove a todo item
  
  version                       Show version information
  upgrade                       Upgrade to the latest version
  
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
  --table                       Output as table (if applicable)
  --terminal                    Output for terminal consumption (minimal formatting)
  --<key> <value>               Pass individual parameters (e.g., --query "AI news")
                                Arrays: --tickers AAPL,GOOGL (comma-separated)
                                Numbers: --count 42
                                Booleans: --enabled true

Options for 'daemon start':
  --port <port>                 WebSocket port (default: 8765)
  --openai-port <port>          OpenAI API port (default: 8787)
  --mcp-proxy                   Enable MCP proxy hub (default: enabled)
  --no-mcp-proxy                Disable MCP proxy hub
  --secure                      Enable edge node security (JWT, ACLs, encryption)
  --debug                       Enable verbose debug logging

Examples:
  rainfall auth login
  rainfall tools list
  rainfall tools describe github-create-issue
  rainfall run exa-web-search -p '{"query": "AI news"}'
  rainfall run exa-web-search --query "AI news"
  rainfall run finviz-quotes --tickers AAPL,GOOGL,MSFT
  rainfall run github-create-issue --owner facebook --repo react --title "Bug"
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

/**
 * Fetch all node IDs from the node-list endpoint
 * This returns all executable tool IDs (including sub-tools like github-create-issue)
 */
async function fetchAllNodeIds(rainfall: Rainfall): Promise<string[]> {
  try {
    const client = rainfall.getClient();
    const subscriberId = await (client as unknown as { ensureSubscriberId(): Promise<string> }).ensureSubscriberId();
    
    const result = await client.request<{ keys?: string[]; nodes?: Array<{ id: string }> }>(
      `/olympic/subscribers/${subscriberId}/nodes/_utils/node-list`
    );
    
    if (result.keys && Array.isArray(result.keys)) {
      return result.keys;
    }
    
    if (result.nodes && Array.isArray(result.nodes)) {
      return result.nodes.map(n => n.id);
    }
    
    return [];
  } catch {
    return [];
  }
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
  const defaultBaseUrl = 'https://olympic-api.pragma-digital.org/v1';

  if (!config.apiKey) {
    console.log('Not authenticated');
    console.log('Run: rainfall auth login <api-key>');
    return;
  }

  // Show custom baseUrl if set (for debugging)
  if (config.baseUrl && config.baseUrl !== defaultBaseUrl) {
    console.log(`API URL: ${config.baseUrl} (custom)`);
  }

  try {
    // Use configured baseUrl for validation if set
    const rainfall = new Rainfall({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const me = await rainfall.getMe();
    console.log(`Authenticated as ${me.name || me.email || 'Unknown'}`);
    console.log(`Plan: ${me.billingStatus || me.plan || 'N/A'}`);
    console.log(`Usage: ${me.usage?.callsThisMonth?.toLocaleString() || 0} / ${me.usage?.callsLimit?.toLocaleString() || 'Unlimited'} calls this month`);
  } catch (error) {
    console.log('Authentication expired or invalid');
    if (config.baseUrl && config.baseUrl !== defaultBaseUrl) {
      console.log(`Note: Using custom URL ${config.baseUrl} - is it running?`);
    }
    console.log('Run: rainfall auth login <api-key>');
    return;
  }

  // Show Google auth status
  console.log();
  if (config.googleTokens?.access_token) {
    const { isTokenExpired } = await import('./auth/google.js');
    const expired = isTokenExpired(config.googleTokens);
    console.log(`Google: ${expired ? '⚠️ Token expired (will auto-refresh)' : '✓ Authenticated'}`);
    if (config.googleTokens.scope) {
      const scopes = config.googleTokens.scope.split(' ');
      const hasGmail = scopes.some(s => s.includes('mail.google.com'));
      const hasSheets = scopes.some(s => s.includes('spreadsheets'));
      const hasDocs = scopes.some(s => s.includes('documents'));
      const hasDrive = scopes.some(s => s.includes('drive'));
      
      console.log(`  Services: ${[
        hasDrive && 'Drive',
        hasSheets && 'Sheets', 
        hasDocs && 'Docs',
        hasGmail && 'Gmail'
      ].filter(Boolean).join(', ') || 'Basic profile only'}`);
      
      if (!hasGmail) {
        console.log(`  Note: Gmail not enabled. Run: rainfall auth google --gmail`);
      }
    }
  } else {
    console.log('Google: Not authenticated');
    console.log('Run: rainfall auth google');
  }
}

async function authGoogle(args: string[]): Promise<void> {
  const { authenticateGoogle, GOOGLE_SCOPES } = await import('./auth/google.js');
  
  // Parse scope options
  const scopes: string[] = [];
  let includeGmail = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--gmail' || arg === '-g') {
      includeGmail = true;
    } else if (arg === '--scopes' || arg === '-s') {
      const scopeList = args[++i];
      if (scopeList) {
        scopes.push(...scopeList.split(','));
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: rainfall auth google [options]

Authenticate with Google to use Google Workspace tools (Drive, Sheets, Docs, Gmail).

Options:
  --gmail, -g          Include Gmail access (requires additional scope)
  --scopes <list>      Custom comma-separated scopes
  --help               Show this help

Examples:
  rainfall auth google                    # Basic auth (Drive, Sheets, Docs)
  rainfall auth google --gmail            # Include Gmail access
  rainfall auth google --scopes "https://www.googleapis.com/auth/calendar"

After authentication, your tokens are stored securely in ~/.rainfall/config.json
and will be used automatically when running Google tools.
`);
      return;
    }
  }
  
  // Default scopes
  const defaultScopes = [
    GOOGLE_SCOPES.userinfo,
    GOOGLE_SCOPES.drive,
    GOOGLE_SCOPES.sheets,
    GOOGLE_SCOPES.docs,
  ];
  
  if (includeGmail) {
    defaultScopes.push(GOOGLE_SCOPES.gmail);
  }
  
  const requestedScopes = scopes.length > 0 ? scopes : defaultScopes;
  
  try {
    await authenticateGoogle(requestedScopes);
    console.log('\n✓ You can now use Google tools:');
    console.log('  rainfall run google-drive-list-files');
    console.log('  rainfall run google-sheets-get-values');
    if (includeGmail) {
      console.log('  rainfall run google-gmail-list-messages');
      console.log('  rainfall run google-gmail-send-message --to "user@example.com" --subject "Hello" --body "Message"');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Google authentication failed: ${message}`);
    process.exit(1);
  }
}

async function authGoogleLogout(): Promise<void> {
  const { logoutGoogle } = await import('./auth/google.js');
  await logoutGoogle();
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

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Calculate Jaro-Winkler similarity between two strings
 * Returns a value between 0 (no match) and 1 (exact match)
 */
function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  
  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a.charAt(i) !== b.charAt(j)) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a.charAt(i) !== b.charAt(k)) transpositions++;
    k++;
  }
  
  // Jaro similarity
  const jaro = ((matches / a.length) + (matches / b.length) + ((matches - transpositions / 2) / matches)) / 3;
  
  // Jaro-Winkler: boost for common prefix
  let prefixLength = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a.charAt(i) === b.charAt(i)) {
      prefixLength++;
    } else {
      break;
    }
  }
  
  const scalingFactor = 0.1;
  return jaro + prefixLength * scalingFactor * (1 - jaro);
}

interface ToolInfo {
  id: string;
  description?: string;
}

/**
 * Calculate similarity score between two tool IDs
 */
function calculateSimilarity(toolId: string, candidateId: string, description = ''): number {
  const lowerToolId = toolId.toLowerCase();
  const lowerCandidate = candidateId.toLowerCase();
  
  // Extract prefix if tool ID has dashes (e.g., "github-create-issue" -> "github")
  const prefix = lowerToolId.split('-')[0];
  const hasPrefix = lowerToolId.includes('-');
  
  // Combine multiple similarity metrics
  const jwScore = jaroWinklerSimilarity(lowerToolId, lowerCandidate);
  
  // Normalize Levenshtein to a 0-1 score (1 = exact match)
  const maxLen = Math.max(lowerToolId.length, lowerCandidate.length);
  const lvScore = maxLen === 0 ? 1 : 1 - (levenshteinDistance(lowerToolId, lowerCandidate) / maxLen);
  
  // Check for substring match (boost score significantly)
  let substringBoost = 0;
  if (lowerCandidate.includes(lowerToolId) || lowerToolId.includes(lowerCandidate)) {
    substringBoost = 0.4;
  }
  
  // Prefix match boost: if user typed "github-..." and tool is "github", boost it
  let prefixBoost = 0;
  if (hasPrefix && lowerCandidate === prefix) {
    prefixBoost = 0.5;
  }
  // Also boost if the tool ID starts with the same prefix
  if (hasPrefix && lowerCandidate.startsWith(prefix + '-')) {
    prefixBoost = 0.35;
  }
  
  // Check description for query terms
  const descMatch = description.toLowerCase().includes(lowerToolId) ? 0.1 : 0;
  
  // Combined score: weight Jaro-Winkler higher as it works well for short strings
  return (jwScore * 0.4) + (lvScore * 0.25) + substringBoost + prefixBoost + descMatch;
}

/**
 * Find similar tools based on string similarity (from tool objects)
 */
function findSimilarTools(toolId: string, tools: { id: string; description: string }[]): string[] {
  const scored = tools.map(tool => ({
    id: tool.id,
    score: calculateSimilarity(toolId, tool.id, tool.description)
  }));
  
  // Sort by score descending and return top matches
  return scored
    .filter(item => item.score > 0.35) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => item.id);
}

/**
 * Find similar tools based on string similarity (from string IDs)
 */
function findSimilarToolIds(toolId: string, toolIds: string[]): string[] {
  const scored = toolIds.map(id => ({
    id,
    score: calculateSimilarity(toolId, id)
  }));
  
  // Sort by score descending and return top matches
  return scored
    .filter(item => item.score > 0.35) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => item.id);
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
    
    // Suggest similar tools using full node list
    try {
      const allNodeIds = await fetchAllNodeIds(rainfall);
      const suggestions = findSimilarToolIds(toolId, allNodeIds);
      
      if (suggestions.length > 0) {
        console.error('\nDid you mean:');
        for (const suggestion of suggestions) {
          console.error(`  • ${suggestion}`);
        }
      }
    } catch {
      // Ignore errors fetching suggestions
    }
    
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
  --table                Output as table (if applicable)
  --terminal             Output for terminal consumption (minimal formatting)
  --target-edge <id>     Execute on specific edge node (for cross-node jobs)
  --<key> <value>        Pass individual parameters (e.g., --query "AI news")
                         Arrays: --tickers AAPL,GOOGL (comma-separated)
                         Numbers: --count 42
                         Booleans: --enabled true

Examples:
  rainfall run figma-users-getMe
  rainfall run exa-web-search -p '{"query": "AI news"}'
  rainfall run exa-web-search --query "AI news"
  rainfall run finviz-quotes --tickers AAPL,GOOGL,MSFT
  rainfall run github-create-issue --owner facebook --repo react --title "Bug"
  rainfall run github-create-issue -f ./issue.json
  rainfall run exa-web-search --query "latest AI" --target-edge <edge-id>
  echo '{"query": "hello"}' | rainfall run exa-web-search
`);
    return;
  }

  let params: Record<string, unknown> = {};
  const rawArgs: string[] = [];
  let displayMode: DisplayMode = 'pretty';
  let targetEdge: string | undefined;

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
      displayMode = 'raw';
    } else if (arg === '--table') {
      displayMode = 'table';
    } else if (arg === '--terminal') {
      displayMode = 'terminal';
    } else if (arg === '--target-edge') {
      targetEdge = args[++i];
      if (!targetEdge) {
        console.error('Error: --target-edge requires an edge node ID');
        process.exit(1);
      }
    } else if (arg.startsWith('--')) {
      // Handle --key value style arguments
      const key = arg.slice(2); // Remove '--'
      const value = args[++i];
      if (value === undefined) {
        // Flag-style boolean
        params[key] = true;
      } else {
        params[key] = value;
      }
    } else {
      // Collect positional arguments
      rawArgs.push(arg);
    }
  }

  // Check for piped input (only if stdin is not a TTY)
  if (!process.stdin.isTTY) {
    process.stdin.pause();
    
    const fs = await import('fs');
    try {
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

  // Fetch schema for smart parsing and validation
  let toolSchema: { parameters?: Record<string, { type?: string; optional?: boolean }> } | undefined;
  try {
    const fullSchema = await rainfall.getToolSchema(toolId);
    toolSchema = {
      parameters: fullSchema.parameters as Record<string, { type?: string; optional?: boolean }> | undefined
    };
  } catch {
    // If we can't fetch schema, proceed without smart parsing
  }

  // Apply schema-aware parsing to CLI args
  // Filter out CLI-specific flags that aren't tool parameters
  const cliFlags = new Set(['--params', '-p', '--file', '-f', '--raw', '--table', '--terminal', '--target-edge']);
  const toolArgs = args.slice(1).filter((arg, i, arr) => {
    // Skip CLI flags and their values
    if (cliFlags.has(arg)) {
      return false;
    }
    // Skip values of CLI flags
    if (i > 0 && cliFlags.has(arr[i - 1])) {
      return false;
    }
    return true;
  });
  
  if (toolSchema?.parameters) {
    const { parseCliArgs } = await import('./core/param-parser.js');
    const parsedParams = parseCliArgs(
      toolArgs, 
      {
        name: toolId,
        description: '',
        category: '',
        parameters: toolSchema.parameters as Record<string, import('./core/param-parser.js').ParamSchema>,
      }
    );
    params = { ...parsedParams, ...params };
  }

  // If we have a single positional argument and no explicit params, 
  // try to use it as the value for a single-parameter tool
  if (rawArgs.length === 1 && Object.keys(params).length === 0 && toolSchema?.parameters) {
    const paramEntries = Object.entries(toolSchema.parameters);
    const requiredParams = paramEntries.filter(([, p]) => !p.optional);
    
    if (requiredParams.length === 1) {
      const [paramName, paramSchema] = requiredParams[0];
      const { parseValue } = await import('./core/param-parser.js');
      params = { [paramName]: parseValue(rawArgs[0], paramSchema as import('./core/param-parser.js').ParamSchema) };
    }
  }

  // Find tool handler if one exists
  const handler = globalHandlerRegistry.findHandler(toolId);
  
  // Build tool context
  const toolContext: ToolContext = {
    rainfall,
    toolId,
    params,
    args: rawArgs,
    flags: { raw: displayMode === 'raw' },
  };

  try {
    // Run preflight if handler exists
    let executionParams = params;
    let preflightContext: Record<string, unknown> | undefined;
    let skipExecution: unknown | undefined;

    if (handler?.preflight) {
      const preflightResult = await handler.preflight(toolContext);
      if (preflightResult) {
        if (preflightResult.skipExecution !== undefined) {
          skipExecution = preflightResult.skipExecution;
        }
        if (preflightResult.params) {
          executionParams = preflightResult.params;
        }
        preflightContext = preflightResult.context;
      }
    }

    // Execute tool (unless preflight skipped it)
    let result: unknown;
    if (skipExecution !== undefined) {
      result = skipExecution;
    } else if (targetEdge) {
      // Execute on specific edge node
      result = await rainfall.executeTool(toolId, executionParams, { targetEdge });
    } else {
      result = await rainfall.executeTool(toolId, executionParams);
    }

    // Build postflight context
    const postflightContext: PostflightContext = {
      ...toolContext,
      result,
      preflightContext,
    };

    // Run postflight if handler exists
    if (handler?.postflight) {
      await handler.postflight(postflightContext);
    }

    // Display result
    let displayed = false;
    if (handler?.display) {
      displayed = await handler.display({ ...postflightContext, flags: { ...toolContext.flags, mode: displayMode } });
    }

    if (!displayed) {
      // Use default display with mode
      const output = await formatResult(result, { mode: displayMode });
      console.log(output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    
    // Suggest similar tools if it looks like a "tool not found" error
    if (message.toLowerCase().includes('not found') || message.toLowerCase().includes('not found')) {
      try {
        const allNodeIds = await fetchAllNodeIds(rainfall);
        const suggestions = findSimilarToolIds(toolId, allNodeIds);
        
        if (suggestions.length > 0) {
          console.error('\nDid you mean:');
          for (const suggestion of suggestions) {
            console.error(`  • ${suggestion}`);
          }
        }
      } catch {
        // Ignore errors fetching suggestions
      }
    }
    
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
  console.log('  custom    - Use any custom OpenAI-compatible endpoint (RunPod, etc.)');
  console.log();
  console.log('Examples:');
  console.log('  rainfall config set llm.provider local');
  console.log('  rainfall config set llm.baseUrl http://localhost:1234/v1');
  console.log('  rainfall config set llm.provider custom');
  console.log('  rainfall config set llm.baseUrl https://your-runpod-endpoint.runpod.net/v1');
  console.log('  rainfall config set llm.provider openai');
  console.log('  rainfall config set llm.apiKey sk-...');
}

// Version and upgrade commands
function getPackageJson(): { version: string; name: string } {
  try {
    // Try to find package.json from the CLI location
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = join(__dirname, '..', '..', 'package.json');
    const content = readFileSync(packagePath, 'utf8');
    return JSON.parse(content);
  } catch {
    // Fallback if we can't read package.json
    return { version: 'unknown', name: '@rainfall-devkit/sdk' };
  }
}

function showVersion(): void {
  const pkg = getPackageJson();
  console.log(`${pkg.name} v${pkg.version}`);
}

async function upgrade(): Promise<void> {
  const pkg = getPackageJson();
  console.log(`Upgrading ${pkg.name}...`);
  
  // Detect package manager based on how the CLI was invoked
  const execPath = process.argv[0];
  const isBun = execPath.includes('bun');
  
  let command: string;
  let args: string[];
  
  if (isBun) {
    command = 'bun';
    args = ['add', '-g', `${pkg.name}@latest`];
  } else {
    // Default to npm
    command = 'npm';
    args = ['i', '-g', `${pkg.name}@latest`];
  }
  
  console.log(`Running: ${command} ${args.join(' ')}`);
  console.log();
  
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log();
        console.log('✓ Upgrade complete');
        resolve();
      } else {
        reject(new Error(`Upgrade failed with exit code ${code}`));
      }
    });
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Daemon commands
async function daemonStart(args: string[]): Promise<void> {
  // Parse options
  let port: number | undefined;
  let openaiPort: number | undefined;
  let debug = false;
  let enableMcpProxy = true; // Enabled by default

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
    } else if (arg === '--mcp-proxy') {
      enableMcpProxy = true;
    } else if (arg === '--no-mcp-proxy') {
      enableMcpProxy = false;
    }
  }

  const { startDaemon } = await import('../daemon/index.js');
  
  try {
    await startDaemon({ port, openaiPort, debug, enableMcpProxy });
    
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
  console.log(`  MCP clients: ${status.mcpClients || 0}`);
  console.log(`  MCP tools: ${status.mcpTools || 0}`);
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

// Edge node commands
async function edgeGenerateKeys(): Promise<void> {
  console.log('🔐 Generating edge node key pair...\n');
  
  try {
    const security = await createEdgeNodeSecurity();
    const keyPair = await security.generateKeyPair();
    
    // Save keys to config directory
    const configDir = getConfigDir();
    const keysDir = join(configDir, 'keys');
    
    if (!existsSync(keysDir)) {
      mkdirSync(keysDir, { recursive: true });
    }
    
    const publicKeyPath = join(keysDir, 'edge-node.pub');
    const privateKeyPath = join(keysDir, 'edge-node.key');
    
    writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 });
    writeFileSync(privateKeyPath, keyPair.privateKey, { mode: 0o600 });
    
    console.log('✅ Key pair generated successfully!\n');
    console.log('Public key:', keyPair.publicKey);
    console.log('\nKey files saved to:');
    console.log('  Public:', publicKeyPath);
    console.log('  Private:', privateKeyPath);
    console.log('\n📋 To register this edge node:');
    console.log('  1. Copy the public key above');
    console.log('  2. Register proc node with: rainfall edge register <proc-node-id> --public-key <key>');
    console.log('  3. The backend will return an edgeNodeSecret (JWT)');
    console.log('  4. Store the secret securely - it expires in 30 days');
    
  } catch (error) {
    console.error('❌ Failed to generate keys:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function edgeRegister(args: string[]): Promise<void> {
  const procNodeId = args[0];
  
  if (!procNodeId) {
    console.error('Error: Proc node ID required');
    console.error('\nUsage: rainfall edge register <proc-node-id> [options]');
    console.error('\nOptions:');
    console.error('  --public-key <key>    Public key for encryption (optional)');
    console.error('  --list <id1,id2,...>  Register multiple proc nodes (comma-separated)');
    console.error('\nExamples:');
    console.error('  rainfall edge register exa-web-search');
    console.error('  rainfall edge register exa-web-search --public-key "base64key..."');
    console.error('  rainfall edge register --list "exa-web-search,github-create-issue"');
    process.exit(1);
  }

  const rainfall = getRainfall();
  const config = loadConfig();
  
  // Parse options
  let publicKey: string | undefined;
  let procNodeIds: string[] = [procNodeId];
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--public-key' || arg === '-k') {
      publicKey = args[++i];
    } else if (arg === '--list' || arg === '-l') {
      const list = args[++i];
      if (list) {
        procNodeIds = list.split(',').map(id => id.trim());
      }
    }
  }

  // Load public key from file if not provided directly
  if (!publicKey) {
    const configDir = getConfigDir();
    const keysDir = join(configDir, 'keys');
    const publicKeyPath = join(keysDir, 'edge-node.pub');
    
    if (existsSync(publicKeyPath)) {
      publicKey = readFileSync(publicKeyPath, 'utf-8');
    }
  }

  console.log(`🌐 Registering ${procNodeIds.length} proc node(s) for edge execution...\n`);

  try {
    // Step 1: Register the edge node itself (or get existing)
    let edgeNodeId = config.edgeNodeId;
    
    if (!edgeNodeId) {
      console.log('📡 Registering edge node with backend...');
      const registerResult = await rainfall.executeTool<{ 
        success: boolean;
        edgeNodeId: string;
        registeredAt: string;
        expiresAt: string;
      }>('register-edge-node', {
        hostname: process.env.HOSTNAME || 'local-edge',
        capabilities: procNodeIds,
        version: '1.0.0',
        metadata: {
          publicKey: publicKey || undefined,
          source: 'rainfall-devkit-cli',
        },
      });
      
      edgeNodeId = registerResult.edgeNodeId;
      console.log(`   Edge node registered: ${edgeNodeId}`);
    } else {
      console.log(`   Using existing edge node: ${edgeNodeId}`);
    }

    // Step 2: Register proc nodes for this edge node
    console.log('\n📡 Registering proc nodes...');
    const result = await rainfall.executeTool<{ 
      success: boolean; 
      edgeNodeId: string;
      edgeNodeSecret: string;
      registeredProcNodes: string[];
    }>('register-proc-edge-nodes', {
      edgeNodeId,
      procNodeIds,
      publicKey,
      hostname: process.env.HOSTNAME || 'local-edge',
    });

    if (!result.success) {
      console.error('❌ Registration failed');
      process.exit(1);
    }

    // Store the edge node credentials in config
    config.edgeNodeId = result.edgeNodeId;
    config.edgeNodeSecret = result.edgeNodeSecret;
    config.edgeNodeKeysPath = join(getConfigDir(), 'keys');
    saveConfig(config);

    console.log('✅ Proc node(s) registered successfully!\n');
    console.log('Edge Node ID:', result.edgeNodeId);
    console.log('Proc Nodes Registered:');
    for (const nodeId of result.registeredProcNodes) {
      console.log(`  • ${nodeId}`);
    }
    console.log('\n🔐 Edge node secret stored in config.');
    console.log('   This secret is used for authentication with the backend.');
    console.log('\n📋 You can now run tools on this edge node:');
    console.log(`   rainfall run ${procNodeIds[0]} --target-edge ${result.edgeNodeId}`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to register proc node:', message);
    
    // Provide helpful guidance for common errors
    if (message.includes('not found') || message.includes('does not exist')) {
      console.error('\n💡 The backend may not have the registration tools yet.');
      console.error('   Make sure you are running the latest version of Rainyday.');
    }
    
    // Handle expired edge node - clear config and suggest retry
    if (message.includes('expired') && config.edgeNodeId) {
      console.error('\n💡 Your edge node registration has expired.');
      console.error('   Clearing stale edge node ID from config...');
      
      // Clear the expired edge node ID
      delete config.edgeNodeId;
      delete config.edgeNodeSecret;
      saveConfig(config);
      
      console.error('   ✅ Config cleared. Please retry the command to register a new edge node.');
    }
    
    process.exit(1);
  }
}

async function edgeStatus(): Promise<void> {
  const configDir = getConfigDir();
  const keysDir = join(configDir, 'keys');
  const publicKeyPath = join(keysDir, 'edge-node.pub');
  const privateKeyPath = join(keysDir, 'edge-node.key');
  
  console.log('🔐 Edge Node Security Status\n');
  
  const hasPublicKey = existsSync(publicKeyPath);
  const hasPrivateKey = existsSync(privateKeyPath);
  
  console.log('Key Pair:');
  console.log('  Public key:', hasPublicKey ? '✅ Present' : '❌ Missing');
  console.log('  Private key:', hasPrivateKey ? '✅ Present' : '❌ Missing');
  
  if (hasPublicKey) {
    const publicKey = readFileSync(publicKeyPath, 'utf-8');
    console.log('\nPublic Key:');
    console.log('  ' + publicKey.substring(0, 50) + '...');
  }
  
  const config = loadConfig();
  
  console.log('\nRegistration:');
  if (config.edgeNodeId) {
    console.log('  Edge Node ID:', config.edgeNodeId);
  } else {
    console.log('  Edge Node ID: ❌ Not registered');
  }
  
  if (config.edgeNodeSecret) {
    console.log('  JWT Secret: ✅ Present');
    // Show a masked version of the secret
    const masked = config.edgeNodeSecret.substring(0, 10) + '...' + 
                   config.edgeNodeSecret.substring(config.edgeNodeSecret.length - 4);
    console.log('    (' + masked + ')');
  } else {
    console.log('  JWT Secret: ❌ Not configured');
  }
  
  // Show proc node registration status
  if (config.procNodeIds && config.procNodeIds.length > 0) {
    console.log('\nRegistered Proc Nodes:');
    for (const nodeId of config.procNodeIds) {
      console.log(`  • ${nodeId}`);
    }
  }
  
  console.log('\n📚 Next steps:');
  if (!hasPublicKey) {
    console.log('  1. Run: rainfall edge generate-keys');
    console.log('  2. Run: rainfall edge register <proc-node-id>');
  } else if (!config.edgeNodeSecret) {
    console.log('  1. Register your proc node:');
    console.log('     rainfall edge register exa-web-search');
  } else {
    console.log('  Edge node is configured and ready for secure operation');
    console.log('  Run tools on this edge node:');
    console.log(`     rainfall run <tool> --target-edge ${config.edgeNodeId}`);
  }
}

async function edgeExposeFunction(args: string[]): Promise<void> {
  let file: string | undefined;
  let name: string | undefined;
  let port = 8787;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg === '-f') {
      file = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      name = args[++i];
    } else if (arg === '--port' || arg === '-p') {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) port = val;
    }
  }

  if (!file || !name) {
    console.error('Error: --file and --name are required');
    console.error('\nUsage: rainfall edge expose-function --file <path> --name <name> [--port <port>]');
    console.error('\nExample:');
    console.error('  rainfall edge expose-function --file ./tools/my-tool.ts --name my-tool');
    process.exit(1);
  }

  const rainfall = getRainfall();

  try {
    await exposeFunction({ file, name, port, rainfall });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to expose function:', message);
    process.exit(1);
  }
}

// ============================================================================
// Todos Commands
// ============================================================================

interface TodoItem {
  id: string;
  category: string;
  title: string;
  description?: string;
  checked: boolean;
  visibility: string;
  mutability: string;
  created_at: string;
}

interface TodosConfig {
  todoToken?: string;
  subscriberId?: string;
}

const TODOS_CONFIG_FILE = join(getConfigDir(), 'todos.json');

function loadTodosConfig(): TodosConfig {
  if (existsSync(TODOS_CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(TODOS_CONFIG_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveTodosConfig(config: TodosConfig): void {
  if (!existsSync(getConfigDir())) {
    mkdirSync(getConfigDir(), { recursive: true });
  }
  writeFileSync(TODOS_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get subscriber ID from config or fetch from API
 */
async function getSubscriberId(rainfall: Rainfall, config: TodosConfig): Promise<string | null> {
  if (config.subscriberId) {
    return config.subscriberId;
  }
  
  try {
    const me = await rainfall.executeTool<{ subscriber?: { id: string } }>('me', {});
    return me.subscriber?.id || null;
  } catch {
    return null;
  }
}

async function todosInit(args: string[]): Promise<void> {
  const config = loadConfig();
  const rainfall = getRainfall();
  
  // Parse options
  let expiresHours = 24;
  let showToken = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expires' || args[i] === '-e') {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) expiresHours = val;
    } else if (args[i] === '--show-token' || args[i] === '-s') {
      showToken = true;
    }
  }
  
  console.log('🔑 Initializing todo list access...\n');
  
  try {
    // Get subscriber info from /subscribers/me endpoint
    const meResult = await rainfall.getClient().request<{
      success: boolean;
      subscriber?: { id: string; name: string };
      error?: string;
    }>('/olympic/subscribers/me', {
      method: 'GET'
    });
    
    if (!meResult.success || !meResult.subscriber) {
      console.error('❌ Failed to get subscriber info:', meResult.error || 'Unknown error');
      console.error('Make sure you are authenticated. Run: rainfall auth login');
      process.exit(1);
    }
    
    const subscriberId = meResult.subscriber.id;
    console.log(`Subscriber: ${meResult.subscriber.name} (${subscriberId})`);
    
    // Mint todo token via API call (using raw client request)
    const result = await rainfall.getClient().request<{
      success: boolean;
      token?: string;
      error?: string;
    }>(`/olympic/subscribers/${subscriberId}/account/todo-token`, {
      method: 'POST',
      body: { expires_hours: expiresHours, capabilities: ['read', 'write'] }
    });
    
    if (!result.success || !result.token) {
      console.error('❌ Failed to mint todo token:', result.error || 'Unknown error');
      process.exit(1);
    }
    
    // Save to config
    const todosConfig: TodosConfig = {
      todoToken: result.token,
      subscriberId: subscriberId
    };
    saveTodosConfig(todosConfig);
    
    console.log('✅ Todo token minted and stored securely!\n');
    
    // Show token if requested (for sharing with web agents)
    if (showToken) {
      console.log('🔐 Your todo token (copy this for web-agent platforms):');
      console.log('─────────────────────────────────────────────────────────');
      console.log(result.token);
      console.log('─────────────────────────────────────────────────────────\n');
    }
    
    console.log('Token expires:', new Date(Date.now() + expiresHours * 60 * 60 * 1000).toLocaleString());
    console.log('\nYour todo list is now accessible via:');
    console.log(`  rainfall todos list`);
    console.log(`  rainfall todos add "Your task here"`);
    
    if (!showToken) {
      console.log('\n💡 To share this token with a web-agent platform, run:');
      console.log(`  rainfall todos init --show-token`);
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to initialize todos:', message);
    process.exit(1);
  }
}

async function todosList(args: string[]): Promise<void> {
  const rainfall = getRainfall();
  const todosConfig = loadTodosConfig();
  
  if (!todosConfig.todoToken || !todosConfig.subscriberId) {
    console.error('❌ Todo token not found. Run: rainfall todos init');
    process.exit(1);
  }
  
  // Parse options
  let category: string | undefined;
  let format = 'table';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' || args[i] === '-c') {
      category = args[++i];
    } else if (args[i] === '--format' || args[i] === '-f') {
      format = args[++i];
    }
  }
  
  try {
    const queryParams = new URLSearchParams();
    if (category) queryParams.set('category', category);
    queryParams.set('format', 'json');
    
    const result = await rainfall.getClient().request<{
      success: boolean;
      items?: TodoItem[];
      error?: string;
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!result.success) {
      console.error('❌ Failed to fetch todos:', result.error);
      process.exit(1);
    }
    
    const items = result.items || [];
    
    if (items.length === 0) {
      console.log('No todo items found.');
      console.log('\nAdd your first todo:');
      console.log('  rainfall todos add "Your task here"');
      return;
    }
    
    // Group by category
    const byCategory = items.reduce((acc, item) => {
      const cat = item.category || 'general';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as Record<string, TodoItem[]>);
    
    // Display
    console.log(`📋 Todo List (${items.filter(i => !i.checked).length} pending, ${items.filter(i => i.checked).length} done)\n`);
    
    for (const [cat, catItems] of Object.entries(byCategory)) {
      console.log(`${cat}:`);
      
      // Sort: unchecked first, then by date
      const sorted = catItems.sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? 1 : -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      for (const item of sorted) {
        const status = item.checked ? '✅' : '⬜';
        const title = item.checked ? `~~${item.title}~~` : item.title;
        const id = item.id.slice(0, 8);
        console.log(`  ${status} [${id}] ${title}`);
      }
      console.log();
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to fetch todos:', message);
    process.exit(1);
  }
}

async function todosAdd(args: string[]): Promise<void> {
  const rainfall = getRainfall();
  const todosConfig = loadTodosConfig();
  
  if (!todosConfig.todoToken || !todosConfig.subscriberId) {
    console.error('❌ Todo token not found. Run: rainfall todos init');
    process.exit(1);
  }
  
  // Parse arguments
  let title = '';
  let category = 'general';
  let visibility = 'private';
  let description: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--category' || arg === '-c') {
      category = args[++i];
    } else if (arg === '--visibility' || arg === '-v') {
      visibility = args[++i];
    } else if (arg === '--description' || arg === '-d') {
      description = args[++i];
    } else if (!title && !arg.startsWith('-')) {
      title = arg;
    }
  }
  
  if (!title) {
    console.error('❌ Title required');
    console.error('\nUsage: rainfall todos add <title> [options]');
    console.error('\nOptions:');
    console.error('  --category, -c <name>     Category (default: general)');
    console.error('  --visibility, -v <type>   public|organization|private (default: private)');
    console.error('  --description, -d <text>  Description');
    console.error('\nExample:');
    console.error('  rainfall todos add "Buy milk" --category shopping --visibility public');
    process.exit(1);
  }
  
  try {
    const result = await rainfall.getClient().request<{
      success: boolean;
      item?: TodoItem;
      error?: string;
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos`, {
      method: 'POST',
      body: {
        title,
        category,
        visibility,
        description,
        mutability: visibility // Same as visibility by default
      },
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!result.success || !result.item) {
      console.error('❌ Failed to add todo:', result.error);
      process.exit(1);
    }
    
    console.log(`✅ Added: ${result.item.title}`);
    console.log(`   ID: ${result.item.id.slice(0, 8)}`);
    console.log(`   Category: ${result.item.category}`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to add todo:', message);
    process.exit(1);
  }
}

async function todosCheck(args: string[], check: boolean): Promise<void> {
  const rainfall = getRainfall();
  const todosConfig = loadTodosConfig();
  
  if (!todosConfig.todoToken || !todosConfig.subscriberId) {
    console.error('❌ Todo token not found. Run: rainfall todos init');
    process.exit(1);
  }
  
  const query = args[0];
  if (!query) {
    console.error(`❌ ${check ? 'Check' : 'Uncheck'} what? Provide an ID or title.`);
    console.error(`\nUsage: rainfall todos ${check ? 'check' : 'uncheck'} <id-or-title>`);
    process.exit(1);
  }
  
  try {
    // First, fetch all todos to find the match
    const listResult = await rainfall.getClient().request<{
      success: boolean;
      items?: TodoItem[];
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos?format=json`, {
      method: 'GET',
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!listResult.success || !listResult.items) {
      console.error('❌ Failed to fetch todos');
      process.exit(1);
    }
    
    // Find matching todo
    const match = listResult.items.find(item => 
      item.id.toLowerCase().startsWith(query.toLowerCase()) ||
      item.title.toLowerCase().includes(query.toLowerCase())
    );
    
    if (!match) {
      console.error(`❌ No todo found matching "${query}"`);
      console.error('\nRun `rainfall todos list` to see your todos.');
      process.exit(1);
    }
    
    // Toggle if needed
    if (match.checked === check) {
      console.log(`${check ? '✅' : '⬜'} "${match.title}" is already ${check ? 'checked' : 'unchecked'}`);
      return;
    }
    
    // Call toggle endpoint
    const result = await rainfall.getClient().request<{
      success: boolean;
      item?: TodoItem;
      error?: string;
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos/${match.id}/toggle_checked`, {
      method: 'POST',
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!result.success || !result.item) {
      console.error('❌ Failed to update todo:', result.error);
      process.exit(1);
    }
    
    console.log(`${result.item.checked ? '✅' : '⬜'} ${result.item.title}`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to update todo:', message);
    process.exit(1);
  }
}

async function todosRemove(args: string[]): Promise<void> {
  const rainfall = getRainfall();
  const todosConfig = loadTodosConfig();
  
  if (!todosConfig.todoToken || !todosConfig.subscriberId) {
    console.error('❌ Todo token not found. Run: rainfall todos init');
    process.exit(1);
  }
  
  const query = args[0];
  if (!query) {
    console.error('❌ Remove what? Provide an ID or title.');
    console.error('\nUsage: rainfall todos rm <id-or-title>');
    process.exit(1);
  }
  
  try {
    // First, fetch all todos to find the match
    const listResult = await rainfall.getClient().request<{
      success: boolean;
      items?: TodoItem[];
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos?format=json`, {
      method: 'GET',
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!listResult.success || !listResult.items) {
      console.error('❌ Failed to fetch todos');
      process.exit(1);
    }
    
    // Find matching todo
    const match = listResult.items.find(item => 
      item.id.toLowerCase().startsWith(query.toLowerCase()) ||
      item.title.toLowerCase().includes(query.toLowerCase())
    );
    
    if (!match) {
      console.error(`❌ No todo found matching "${query}"`);
      console.error('\nRun `rainfall todos list` to see your todos.');
      process.exit(1);
    }
    
    // Confirm deletion
    console.log(`Remove: "${match.title}"?`);
    console.log('This action cannot be undone. [y/N]');
    
    // For now, just delete without confirmation in non-interactive mode
    // TODO: Add interactive confirmation when stdin is TTY
    
    // Call delete endpoint
    const result = await rainfall.getClient().request<{
      success: boolean;
      error?: string;
    }>(`/olympic/subscribers/${todosConfig.subscriberId}/todos/${match.id}`, {
      method: 'DELETE',
      headers: {
        'x-todo-token': todosConfig.todoToken
      }
    });
    
    if (!result.success) {
      console.error('❌ Failed to remove todo:', result.error);
      process.exit(1);
    }
    
    console.log(`🗑️  Removed: "${match.title}"`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to remove todo:', message);
    process.exit(1);
  }
}

async function todosToken(): Promise<void> {
  const todosConfig = loadTodosConfig();
  
  if (!todosConfig.todoToken || !todosConfig.subscriberId) {
    console.error('❌ Todo token not found. Run: rainfall todos init');
    process.exit(1);
  }

  console.log('🔐 Your todo token:\n');
  console.log('─────────────────────────────────────────────────────────');
  console.log(todosConfig.todoToken);
  console.log('─────────────────────────────────────────────────────────\n');
  console.log('Subscriber ID:', todosConfig.subscriberId);
  console.log('\nUse this token with web-agent platforms! Either as header or query parameter.');
  console.log(`Visit https://olympic-api.pragma-digital.org/v1/olympic/subscribers/${todosConfig.subscriberId}/todos?token=${todosConfig.todoToken.slice(0, 20)}... (or paste it in to your favorite chat AI with web browsing capabilities).`)
  console.log("You can also pass the token as an x-todo-token header to the API.")
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
        case 'google':
          await authGoogle(rest);
          break;
        case 'google-logout':
          await authGoogleLogout();
          break;
        default:
          console.error('Error: Unknown auth subcommand');
          console.error('\nUsage: rainfall auth <login|logout|status|google|google-logout>');
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

    case 'version':
    case '--version':
    case '-v':
      showVersion();
      break;

    case 'upgrade':
      await upgrade();
      break;

    case 'edge':
      switch (subcommand) {
        case 'generate-keys':
          await edgeGenerateKeys();
          break;
        case 'register':
          await edgeRegister(rest);
          break;
        case 'expose-function':
          await edgeExposeFunction(rest);
          break;
        case 'status':
          await edgeStatus();
          break;
        default:
          console.error('Error: Unknown edge subcommand');
          console.error('\nUsage: rainfall edge <generate-keys|register|expose-function|status>');
          process.exit(1);
      }
      break;

    case 'todos':
      switch (subcommand) {
        case 'init':
          await todosInit(rest);
          break;
        case 'list':
          await todosList(rest);
          break;
        case 'add':
          await todosAdd(rest);
          break;
        case 'check':
          await todosCheck(rest, true);
          break;
        case 'uncheck':
          await todosCheck(rest, false);
          break;
        case 'rm':
        case 'remove':
          await todosRemove(rest);
          break;
        case 'token':
          await todosToken();
          break;
        default:
          console.error('Error: Unknown todos subcommand');
          console.error('\nUsage: rainfall todos <init|list|add|check|uncheck|rm|token>');
          console.error('\nExamples:');
          console.error('  rainfall todos init                    # Mint and store todo token');
          console.error('  rainfall todos init --show-token       # Mint and display token for sharing');
          console.error('  rainfall todos token                   # Show existing token');
          console.error('  rainfall todos list                    # Show your todos');
          console.error('  rainfall todos add "Buy milk"          # Add a todo item');
          console.error('  rainfall todos add "Review PR" --category work --visibility public');
          console.error('  rainfall todos check 123e4567        # Mark as done (partial ID match)');
          console.error('  rainfall todos uncheck "Buy milk"    # Mark as not done (title match)');
          console.error('  rainfall todos rm 123e4567           # Remove a todo');
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
