/**
 * Agent Commands for Rainfall CLI
 * Provides agent listing, switching, and detail display.
 * ISOLATED: No codebox, desktop-commander, or compiled tool imports.
 * Pure devkit features: metadata, config, model specs.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, saveConfig } from './config.js';

// External agent library (development)
const AGENTS_ROOT = join(homedir(), 'Code', 'pragma-digital', 'agents');
// User-local agents (expand your own memory architecture)
const USER_AGENTS_ROOT = join(homedir(), '.rainfall', 'agents');
const CONFIG_DIR = join(homedir(), '.rainfall');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface AgentProfile {
  agent_name: string;
  version?: string;
  default_user?: string;
  work_dir?: string;
  preferences?: {
    communication_style?: string;
    confidence_threshold?: string;
    creativity_level?: string;
    [key: string]: unknown;
  };
  providers?: {
    default?: string;
    fallback?: string[];
  };
  models?: {
    default?: string;
    summarizer?: string;
    fast_task?: string;
    creative_task?: string;
    [key: string]: string | undefined;
  };
  capabilities?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * Create default 'rainier' agent template in ~/.rainfall/agents/
 */
function createDefaultAgent(): void {
  const agentDir = join(USER_AGENTS_ROOT, 'rainier');

  // Create directory if needed
  if (!existsSync(USER_AGENTS_ROOT)) {
    mkdirSync(USER_AGENTS_ROOT, { recursive: true });
  }
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }

  // profile.json
  const profileJson = {
    agent_name: 'rainier',
    version: '1.0.0',
    default_user: 'User',
    work_dir: homedir(),
    preferences: {
      communication_style: 'friendly',
      confidence_threshold: 'medium',
      creativity_level: 'balanced'
    },
    providers: {
      default: 'openai',
      fallback: ['anthropic']
    },
    models: {
      default: 'openai/gpt-oss-120b',
      summarizer: 'openai/gpt-oss-20b',
      fast_task: 'openai/gpt-oss-20b'
    },
    capabilities: {
      code_analysis: true,
      file_operations: true,
      workflow_execution: true
    }
  };

  // persona-light.md (summary)
  const personaLight = '# Rainier\nA lightweight agent for getting started with Rainfall Devkit.';

  // persona.md (full template)
  const personaMd = `# Rainier Agent

## Overview
A lightweight agent for getting started with Rainfall Devkit. Customize this file to define behavior, tools, and approaches.

## Core Instructions
- Be direct and efficient with tasks
- Ask clarifying questions when needed
- Focus on quick task completion

## User Context
This agent operates with a default user profile. Customize this section to include specific user information, preferences, and context.

## Expand Your Memory Architecture
This agent template is a starting point. You can expand it with:
- Custom tool configurations
- Memory and session management
- Learning and feedback systems
- RLHF integration patterns

Modify these files to build your personalized agent system.`;

  // Write files
  writeFileSync(join(agentDir, 'profile.json'), JSON.stringify(profileJson, null, 2));
  writeFileSync(join(agentDir, 'persona-light.md'), personaLight);
  writeFileSync(join(agentDir, 'persona.md'), personaMd);

  console.log(`Created default agent 'rainier' - customize your agent at ~/.rainfall/agents/rainier/`);
}

/**
 * Discover available agents from both external and user-local directories.
 * External agents take priority, but user-local agents are always available.
 */
function discoverAgents(): string[] {
  const agents = new Set<string>();

  // Check external library first
  if (existsSync(AGENTS_ROOT)) {
    const entries = readdirSync(AGENTS_ROOT, { withFileTypes: true });
    entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .filter(entry => {
        const profilePath = join(AGENTS_ROOT, entry.name, 'profile.json');
        return existsSync(profilePath);
      })
      .forEach(entry => agents.add(entry.name));
  }

  // Check user-local agents
  if (existsSync(USER_AGENTS_ROOT)) {
    const entries = readdirSync(USER_AGENTS_ROOT, { withFileTypes: true });
    entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .filter(entry => {
        const profilePath = join(USER_AGENTS_ROOT, entry.name, 'profile.json');
        return existsSync(profilePath);
      })
      .forEach(entry => agents.add(entry.name));
  }

  // If no agents found, create default rainier
  if (agents.size === 0) {
    createDefaultAgent();
    agents.add('rainier');
  }

  return Array.from(agents);
}

/**
 * Load agent profile from disk (checks both external and user-local).
 */
function loadProfile(agentName: string): AgentProfile {
  // Try external library first, then user-local
  const profilePath = join(AGENTS_ROOT, agentName, 'profile.json');
  const userProfilePath = join(USER_AGENTS_ROOT, agentName, 'profile.json');

  let actualPath = '';
  if (existsSync(profilePath)) {
    actualPath = profilePath;
  } else if (existsSync(userProfilePath)) {
    actualPath = userProfilePath;
  } else {
    throw new Error(`Agent "${agentName}" not found (no profile.json)`);
  }

  const data = readFileSync(actualPath, 'utf-8');
  return JSON.parse(data);
}

/**
 * Get the first line of persona-light.md as a summary (checks both locations).
 */
function getPersonaSummary(agentName: string): string {
  // Try external library first, then user-local
  const personaLightPath = join(AGENTS_ROOT, agentName, 'persona-light.md');
  const userPersonaLightPath = join(USER_AGENTS_ROOT, agentName, 'persona-light.md');

  let actualPath = '';
  if (existsSync(personaLightPath)) {
    actualPath = personaLightPath;
  } else if (existsSync(userPersonaLightPath)) {
    actualPath = userPersonaLightPath;
  } else {
    return '(no summary available)';
  }

  const content = readFileSync(actualPath, 'utf-8');
  // Find first non-empty, non-heading line as summary
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return '(no summary available)';
}

/**
 * Get full persona content (checks both locations).
 */
function getPersonaFull(agentName: string): string {
  const personaPath = join(AGENTS_ROOT, agentName, 'persona.md');
  const userPersonaPath = join(USER_AGENTS_ROOT, agentName, 'persona.md');

  let actualPath = '';
  if (existsSync(personaPath)) {
    actualPath = personaPath;
  } else if (existsSync(userPersonaPath)) {
    actualPath = userPersonaPath;
  } else {
    return '';
  }

  return readFileSync(actualPath, 'utf-8');
}

// ─── Commands ───────────────────────────────────────────────────────

/**
 * rainfall agent chat [message]
 * Chat with the active agent using Rainfall's chat completions API.
 * If no message is provided, enters REPL mode for multi-turn conversation.
 */
export async function agentChat(args: string[]): Promise<void> {
  const config = loadConfig();
  const activeAgent = (config as Record<string, unknown>)?.agent
    ? (config as any).agent?.active
    : undefined;

  if (!activeAgent) {
    console.error('Error: No active agent set.');
    console.error('Run "rainfall agent switch <name>" to set an active agent.');
    process.exit(1);
  }

  // Load agent profile and persona
  const profile = loadProfile(activeAgent);
  const persona = getPersonaFull(activeAgent);
  const model = profile.models?.default || 'gpt-4o';

  // Initialize Rainfall SDK
  const { Rainfall } = await import('../sdk.js');
  const rainfall = new Rainfall({ apiKey: config.apiKey });

  // Get subscriber ID
  const me = await rainfall.getMe();

  // System message with agent persona
  const systemMessage = persona
    ? `You are ${activeAgent}. ${persona}\n\nRespond naturally, following your persona and capabilities defined in your profile.`
    : `You are ${activeAgent}, an AI assistant. Respond naturally and helpfully.`;

  const message = args[0];

  if (message) {
    // Single message mode
    console.log(`🤖 ${activeAgent}:`);

    const response = await rainfall.ai.chatCompletions({
      subscriber_id: me.id,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: message }
      ],
      model,
      stream: true,
    });

    // Handle streaming response
    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        // Parse SSE format
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                process.stdout.write(content);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
      console.log('\n');
    }
  } else {
    // REPL mode
    const { createInterface } = await import('readline');
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemMessage }
    ];

    console.log(`🤖 ${activeAgent} (REPL mode)`);
    console.log('Type "exit" or press Ctrl+C to quit.\n');

    const ask = (prompt: string): Promise<string> => {
      return new Promise(resolve => {
        rl.question(prompt, resolve);
      });
    };

    while (true) {
      const input = await ask('> ');

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        rl.close();
        console.log('\n👋 Goodbye!');
        break;
      }

      if (!input.trim()) continue;

      // Add user message
      messages.push({ role: 'user', content: input });

      // Get response
      console.log(`🤖 ${activeAgent}:`);

      const response = await rainfall.ai.chatCompletions({
        subscriber_id: me.id,
        messages,
        model,
        stream: true,
      });

      let assistantMessage = '';

      // Handle streaming response
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  process.stdout.write(content);
                  assistantMessage += content;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      }

      console.log('\n');

      // Add assistant message to conversation history
      messages.push({ role: 'assistant', content: assistantMessage });
    }
  }
}

/**
 * rainfall agent list
 * Lists all available agents with name, summary, and default model.
 */
export async function agentList(): Promise<void> {
  const agents = discoverAgents();

  if (agents.length === 0) {
    console.log('No agents found in', AGENTS_ROOT);
    return;
  }

  // Load config to show active agent
  const config = loadConfig();
  const activeAgent = (config as Record<string, unknown>)?.agent
    ? (config as any).agent?.active
    : undefined;

  console.log('');
  console.log('  Available Agents');
  console.log('  ─────────────────────────────────────────────────────');

  for (const name of agents) {
    const profile = loadProfile(name);
    const model = profile.models?.default || 'unknown';
    const summary = getPersonaSummary(name);
    const active = activeAgent === name ? ' (active)' : '';

    console.log(`  ${name}${active}`);
    console.log(`    model: ${model}`);
    console.log(`    ${summary}`);
    console.log('');
  }
}

/**
 * rainfall agent switch <name>
 * Sets the active agent in rainfall config.
 */
export async function agentSwitch(args: string[]): Promise<void> {
  const agentName = args[0];

  if (!agentName) {
    console.error('Error: Agent name required');
    console.error('Usage: rainfall agent switch <name>');
    console.error('Run "rainfall agent list" to see available agents.');
    process.exit(1);
  }

  // Validate agent exists
  const agents = discoverAgents();
  if (!agents.includes(agentName)) {
    console.error(`Error: Agent "${agentName}" not found.`);
    console.error(`Available agents: ${agents.join(', ')}`);
    process.exit(1);
  }

  // Load existing config, set agent.active, save
  const config = loadConfig();
  const configRecord = config as Record<string, unknown>;
  configRecord.agent = { active: agentName };
  saveConfig(config);

  console.log(`✓ Active agent set to "${agentName}"`);
}

/**
 * rainfall agent show <name>
 * Shows detailed agent information.
 */
export async function agentShow(args: string[]): Promise<void> {
  const agentName = args[0];

  if (!agentName) {
    console.error('Error: Agent name required');
    console.error('Usage: rainfall agent show <name>');
    console.error('Run "rainfall agent list" to see available agents.');
    process.exit(1);
  }

  // Validate agent exists
  const agents = discoverAgents();
  if (!agents.includes(agentName)) {
    console.error(`Error: Agent "${agentName}" not found.`);
    console.error(`Available agents: ${agents.join(', ')}`);
    process.exit(1);
  }

  const profile = loadProfile(agentName);

  console.log('');
  console.log(`  ${profile.agent_name} — Agent Profile`);
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  Version:    ${profile.version || 'N/A'}`);
  console.log(`  Default user: ${profile.default_user || 'N/A'}`);
  console.log(`  Work dir:   ${profile.work_dir || 'N/A'}`);
  console.log('');

  // Preferences
  if (profile.preferences) {
    console.log('  Preferences');
    const prefs = profile.preferences;
    if (prefs.communication_style) console.log(`    style:      ${prefs.communication_style}`);
    if (prefs.confidence_threshold) console.log(`    confidence: ${prefs.confidence_threshold}`);
    if (prefs.creativity_level) console.log(`    creativity: ${prefs.creativity_level}`);
    console.log('');
  }

  // Models
  if (profile.models) {
    console.log('  Models');
    for (const [key, value] of Object.entries(profile.models)) {
      if (typeof value === 'string') {
        console.log(`    ${key.padEnd(14)} ${value}`);
      }
    }
    console.log('');
  }

  // Providers
  if (profile.providers) {
    console.log('  Providers');
    if (profile.providers.default) console.log(`    default:   ${profile.providers.default}`);
    if (profile.providers.fallback) console.log(`    fallback:  ${profile.providers.fallback.join(', ')}`);
    console.log('');
  }

  // Capabilities
  if (profile.capabilities) {
    const caps = Object.entries(profile.capabilities)
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/_/g, ' '));
    if (caps.length > 0) {
      console.log('  Capabilities');
      console.log(`    ${caps.join(', ')}`);
      console.log('');
    }
  }

  // Tools
  if ((profile as any).tools) {
    const tools = (profile as any).tools;
    console.log('  Tools');
    if (tools.enabled) console.log(`    enabled:  ${tools.enabled.join(', ')}`);
    if (tools.disabled) console.log(`    disabled: ${tools.disabled.join(', ')}`);
    console.log('');
  }

  // Computer use
  if ((profile as any).computer_use) {
    const cu = (profile as any).computer_use;
    console.log('  Computer Use');
    console.log(`    enabled:  ${cu.enabled}`);
    if (cu.default_approach) console.log(`    approach: ${cu.default_approach}`);
    if (cu.vision_model) console.log(`    vision:   ${cu.vision_model}`);
    console.log('');
  }
}
