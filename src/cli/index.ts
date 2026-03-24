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
  
  edge generate-keys            Generate key pair for edge node encryption
  edge status                   Show edge node security status
  
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
  echo '{"query": "hello"}' | rainfall run exa-web-search
`);
    return;
  }

  let params: Record<string, unknown> = {};
  const rawArgs: string[] = [];
  let displayMode: DisplayMode = 'pretty';

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
  const cliFlags = new Set(['--params', '-p', '--file', '-f', '--raw', '--table', '--terminal']);
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
    console.log('  2. Register with: rainfall edge register <public-key>');
    console.log('  3. The backend will return an edgeNodeSecret (JWT)');
    console.log('  4. Store the secret securely - it expires in 30 days');
    
  } catch (error) {
    console.error('❌ Failed to generate keys:', error instanceof Error ? error.message : error);
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
  if (config.edgeNodeId) {
    console.log('\nRegistration:');
    console.log('  Edge Node ID:', config.edgeNodeId);
  }
  
  if (config.edgeNodeSecret) {
    console.log('  JWT Secret: ✅ Present (expires: check with backend)');
  } else {
    console.log('  JWT Secret: ❌ Not configured');
  }
  
  console.log('\n📚 Next steps:');
  if (!hasPublicKey) {
    console.log('  1. Run: rainfall edge generate-keys');
  } else if (!config.edgeNodeSecret) {
    console.log('  1. Register your edge node with the backend');
    console.log('  2. Store the returned edgeNodeSecret in config');
  } else {
    console.log('  Edge node is configured and ready for secure operation');
  }
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
        case 'status':
          await edgeStatus();
          break;
        default:
          console.error('Error: Unknown edge subcommand');
          console.error('\nUsage: rainfall edge <generate-keys|status>');
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
