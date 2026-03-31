/**
 * rainfall edge expose-function
 *
 * Loads a local TS/JS file exporting `default ({ rainfall }) => ({ name, description, schema, execute })`,
 * validates the shape, registers it as an edge proc node, and tells the running daemon to load it.
 */

import { Rainfall } from '../../sdk.js';
import { loadConfig, saveConfig, getConfigDir } from '../config.js';
import { resolve, join } from 'path';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

export interface ExposeFunctionOptions {
  file: string;
  name: string;
  port?: number;
  rainfall: Rainfall;
}

export interface ExposeFunctionResult {
  success: boolean;
  name: string;
  edgeNodeId?: string;
  error?: string;
}

function transpileIfNeeded(filePath: string): string {
  if (!filePath.endsWith('.ts')) {
    return filePath;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'rainfall-cli-'));
  const outPath = join(tempDir, 'function.js');

  try {
    execSync(`bun build "${filePath}" --outfile "${outPath}" --target node`, {
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (error) {
    throw new Error(
      `Failed to transpile ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return outPath;
}

function loadAndValidate(filePath: string, rainfall: Rainfall, expectedName: string) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const jsPath = transpileIfNeeded(resolvedPath);

  // Clear require cache so reloads pick up changes
  delete require.cache[require.resolve(jsPath)];
  const module = require(jsPath);
  const factory = module.default || module;

  if (typeof factory !== 'function') {
    throw new Error(`Module at ${resolvedPath} must export a default function`);
  }

  const definition = factory({ rainfall });

  if (!definition || typeof definition !== 'object') {
    throw new Error(`Factory must return an object with { name, description, schema, execute }`);
  }

  const { name, description, schema, execute } = definition;

  if (!name || typeof name !== 'string') {
    throw new Error(`Local function must have a string 'name'`);
  }

  if (name !== expectedName) {
    throw new Error(`Function name mismatch: expected "${expectedName}", got "${name}"`);
  }

  if (!description || typeof description !== 'string') {
    throw new Error(`Local function must have a string 'description'`);
  }

  if (!schema || typeof schema !== 'object') {
    throw new Error(`Local function must have an object 'schema'`);
  }

  if (typeof execute !== 'function') {
    throw new Error(`Local function must have an 'execute' function`);
  }

  return { name, description, schema, execute };
}

export async function exposeFunction(options: ExposeFunctionOptions): Promise<ExposeFunctionResult> {
  const { file, name, port = 8787, rainfall } = options;
  const config = loadConfig();

  // 1. Load and validate the local module
  console.log(`📂 Loading local function from ${file}...`);
  loadAndValidate(file, rainfall, name);
  console.log(`✅ Validated local function: ${name}`);

  // 2. Register edge node (reuse existing or create new)
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
      capabilities: [name],
      version: '1.0.0',
      metadata: {
        source: 'rainfall-devkit-cli',
      },
    });
    edgeNodeId = registerResult.edgeNodeId;
    console.log(`   Edge node registered: ${edgeNodeId}`);
  } else {
    console.log(`   Using existing edge node: ${edgeNodeId}`);
  }

  // 3. Register proc node for this function
  console.log('\n📡 Registering proc node...');
  const result = await rainfall.executeTool<{
    success: boolean;
    edgeNodeId: string;
    edgeNodeSecret: string;
    registeredProcNodes: string[];
  }>('register-proc-edge-nodes', {
    edgeNodeId,
    procNodeIds: [name],
    hostname: process.env.HOSTNAME || 'local-edge',
  });

  if (!result.success) {
    throw new Error('Backend returned unsuccessful registration');
  }

  // Store credentials
  config.edgeNodeId = result.edgeNodeId;
  config.edgeNodeSecret = result.edgeNodeSecret;
  config.edgeNodeKeysPath = join(getConfigDir(), 'keys');
  saveConfig(config);

  console.log('✅ Proc node registered successfully!');
  console.log('Edge Node ID:', result.edgeNodeId);
  console.log('Proc Node:', name);

  // 4. Tell the daemon to load this local function
  console.log('\n📡 Notifying daemon...');
  try {
    const response = await fetch(`http://localhost:${port}/admin/load-local-function`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: resolve(file), name }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Daemon responded ${response.status}: ${body}`);
    }

    const json = await response.json() as { success?: boolean; error?: string };
    if (!json.success) {
      throw new Error(`Daemon failed to load function: ${json.error || 'unknown error'}`);
    }

    console.log('✅ Daemon loaded local function successfully!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Failed to notify daemon: ${message}`);
    console.warn('   Make sure the daemon is running: rainfall daemon start');
    console.warn('   You can reload the function manually by restarting the daemon.');
  }

  return {
    success: true,
    name,
    edgeNodeId: result.edgeNodeId,
  };
}
