/**
 * rainfall edge expose-function
 *
 * Loads a local TS/JS file exporting `default ({ rainfall }) => ({ name, description, schema, execute })`,
 * validates the shape, tells the running daemon to load it, and registers the schema centrally.
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

  // 1. Load and validate the local module
  console.log(`📂 Loading local function from ${file}...`);
  const definition = loadAndValidate(file, rainfall, name);
  console.log(`✅ Validated local function: ${name}`);

  // 2. Get the daemon's edge node ID from status endpoint
  console.log('\n📡 Getting edge node info from daemon...');
  let edgeNodeId: string;
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Daemon responded ${response.status}`);
    }

    const health = await response.json() as { edge_node_id?: string };
    if (!health.edge_node_id) {
      throw new Error('Daemon does not have an active edge node ID');
    }
    edgeNodeId = health.edge_node_id;
    console.log(`   Using daemon's edge node: ${edgeNodeId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get edge node info from daemon: ${message}. Make sure the daemon is running: rainfall daemon start`);
  }

  // 3. Register proc node for this function with the daemon's edge node ID
  console.log('\n📡 Registering proc node...');
  
  let result: {
    success: boolean;
    edgeNodeId: string;
    edgeNodeSecret: string;
    registeredProcNodes: string[];
  };
  
  try {
    result = await rainfall.executeTool<{
      success: boolean;
      edgeNodeId: string;
      edgeNodeSecret: string;
      registeredProcNodes: string[];
    }>('register-proc-edge-nodes', {
      edgeNodeId,
      procNodeIds: [name],
      hostname: process.env.HOSTNAME || 'local-edge',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to register proc node: ${message}`);
  }

  if (!result.success) {
    throw new Error('Backend returned unsuccessful registration');
  }

  // Store credentials
  const config = loadConfig();
  config.edgeNodeId = result.edgeNodeId;
  config.edgeNodeSecret = result.edgeNodeSecret;
  config.edgeNodeKeysPath = join(getConfigDir(), 'keys');
  config.procNodeIds = [...new Set([...(config.procNodeIds || []), name])];
  saveConfig(config);

  console.log('✅ Proc node registered successfully!');
  console.log('Edge Node ID:', result.edgeNodeId);
  console.log('Proc Node:', name);

  // 4. Register the schema centrally so /params and node_list can find it
  console.log('\n📡 Registering function schema...');
  try {
    await rainfall.executeTool('register-node-schema', {
      nodeId: name,
      name,
      description: definition.description,
      parameters: definition.schema,
      category: 'edge',
      visibility: 'private',
      edgeNodeId: result.edgeNodeId,
    });
    console.log('✅ Schema registered centrally');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  Failed to register schema centrally: ${message}`);
    console.warn('   The function will still work, but /params may return blank.');
  }

  // 5. Tell the daemon to load this local function
  console.log('\n📡 Notifying daemon...');
  try {
    const response = await fetch(`http://localhost:${port}/admin/load-local-function`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        filePath: resolve(file), 
        name,
        description: definition.description,
        schema: definition.schema,
      }),
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
