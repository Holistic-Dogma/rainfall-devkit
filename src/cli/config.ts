/**
 * CLI Configuration - Shared config loading for CLI and daemon
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.rainfall');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * LLM Provider configuration
 * Supports: rainfall (default), openai, anthropic, ollama, local
 */
export interface LLMConfig {
  /** Provider type - defaults to 'rainfall' for credit-based usage */
  provider: 'rainfall' | 'openai' | 'anthropic' | 'ollama' | 'local' | 'custom';
  /** API key for the provider (not needed for ollama/local) */
  apiKey?: string;
  /** Base URL for the provider (e.g., 'http://localhost:11434/v1' for ollama) */
  baseUrl?: string;
  /** Default model to use */
  model?: string;
  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}

export interface Config {
  /** Rainfall API key for tool access and credit-based LLM usage */
  apiKey?: string;
  /** Rainfall backend base URL */
  baseUrl?: string;
  /** LLM provider configuration */
  llm?: LLMConfig;
  /** 
   * @deprecated Use llm.apiKey instead for OpenAI-specific key
   * This field is kept for backward compatibility
   */
  openaiApiKey?: string;
  /** Edge node ID (assigned by backend on registration) */
  edgeNodeId?: string;
  /** Edge node JWT secret (for authentication with backend) */
  edgeNodeSecret?: string;
  /** Path to edge node key pair directory */
  edgeNodeKeysPath?: string;
  /** Enable secure mode (JWT validation, ACLs, encryption) */
  secureMode?: boolean;
}

/**
 * Load configuration from ~/.rainfall/config.json
 * Also checks environment variables as fallbacks
 */
export function loadConfig(): Config {
  let config: Config = {};
  
  // Load from file if exists
  if (existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      config = {};
    }
  }
  
  // Environment variable overrides
  if (process.env.RAINFALL_API_KEY) {
    config.apiKey = process.env.RAINFALL_API_KEY;
  }
  if (process.env.RAINFALL_BASE_URL) {
    config.baseUrl = process.env.RAINFALL_BASE_URL;
  }
  
  // LLM provider environment variables
  if (!config.llm) {
    config.llm = { provider: 'rainfall' };
  }
  
  // Check for provider-specific env vars
  if (process.env.OPENAI_API_KEY) {
    config.llm.provider = config.llm.provider || 'openai';
    config.llm.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    config.llm.provider = 'anthropic';
    config.llm.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OLLAMA_HOST || process.env.OLLAMA_URL) {
    config.llm.provider = 'ollama';
    config.llm.baseUrl = process.env.OLLAMA_HOST || process.env.OLLAMA_URL;
  }
  
  // Model override
  if (process.env.LLM_MODEL) {
    config.llm.model = process.env.LLM_MODEL;
  }
  
  return config;
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get the effective LLM configuration with defaults applied
 */
export function getLLMConfig(config: Config): Required<LLMConfig> {
  const defaults: Required<LLMConfig> = {
    provider: 'rainfall',
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || 'https://api.rainfall.com',
    model: 'llama-3.3-70b-versatile',
    options: {},
  };
  
  return { ...defaults, ...config.llm };
}

/**
 * Check if using a local/offline provider
 */
export function isLocalProvider(config: Config): boolean {
  return config.llm?.provider === 'ollama' || config.llm?.provider === 'local';
}

/**
 * Get the provider-specific base URL
 */
export function getProviderBaseUrl(config: Config): string {
  const provider = config.llm?.provider || 'rainfall';
  
  switch (provider) {
    case 'openai':
      return config.llm?.baseUrl || 'https://api.openai.com/v1';
    case 'anthropic':
      return config.llm?.baseUrl || 'https://api.anthropic.com/v1';
    case 'ollama':
      return config.llm?.baseUrl || 'http://localhost:11434/v1';
    case 'local':
    case 'custom':
      return config.llm?.baseUrl || 'http://localhost:1234/v1';
    case 'rainfall':
    default:
      return config.baseUrl || 'https://api.rainfall.com';
  }
}
