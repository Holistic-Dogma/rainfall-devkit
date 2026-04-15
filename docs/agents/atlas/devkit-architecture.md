# Rainfall DevKit Architecture Atlas 🗺️

**Source:** `/Users/fall/Code/pragma-digital/olympic/rainfall-devkit`
**Last Updated:** 2026-04-13 (Sprint 1.5 - Acceleration Phase)
**Target Readers:** System Architect + Marketing Agent
**Package:** `@rainfall-devkit/sdk` v0.2.18

---

## 🔥 TL;DR: What DevKit Actually Does

| Layer | Component | Purpose |
|-------|-----------|---------|
| **CLI Interface** | `bun run cli` | Terminal harness with 30+ commands (auth, tools, agents, daemon) |
| **SDK Core** | `Rainfall` class | TypeScript-first API wrapper with automatic retries & validation |
| **200+ Tools** | Registry-driven nodes | Proc-nodes for GitHub, Notion, Linear, Slack, Figma, Stripe + AI |
| **Proc Nodes** | Node.js execution | Backend workflow system with credential auto-discovery |
| **PSMs** | Hierarchical JSONB configs | Chainable schemaless configurations (parent-child relationships) |
| **Daemon System** | Local server | WebSocket + OpenAI-compatible proxy for MCP clients |
| **Distributed Edge** | Networked jobs | Queue-based execution across multiple edge nodes |
| **Ubiquity API** | Schema management | Hierarchical endpoint definitions for external services |

---

## 🏗️ CORE ARCHITECTURE

### 1. Entry Points & Boot Sequence

#### `src/index.ts` - Public SDK Surface (Lines 1-135)

```typescript
// Core exports
export { RainfallClient } from './client.js';
export { Rainfall } from './sdk.js';

// Error types
export {
  RainfallError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  ServerError,
  TimeoutError,
  NetworkError,
  ToolNotFoundError,
} from './errors.js';

// Type exports
export type { RainfallConfig, RequestOptions, ApiResponse } from './types.js';

// Validation
export {
  fetchToolSchema,
  validateParams,
  formatValidationErrors,
  clearSchemaCache,
} from './validation.js';

// Daemon service exports (for programmatic use)
export { RainfallNetworkedExecutor, RainfallDaemonContext, ... } from './services/';
```

**Boot Sequence:**
1. Import main SDK class
2. Instantiate with config (`apiKey`, `baseUrl`, `timeout`, `retries`)
3. Use namespace DSL (`rainfall.web.search.exa()`) or low-level API

#### `src/cli/index.ts` - CLI Entry Point (Lines 1-2629)

```typescript
// Auto-import all handlers from src/cli/handlers/
import { globalHandlerRegistry } from './handlers/_registry.js';

function printHelp(): void {
  console.log(`
Rainfall CLI - 200+ tools, one key

Commands:
  auth login                    Store API key
  tools list                    List all available tools
  run <tool> [options]          Execute a tool
  
  daemon start                  Start the Rainfall daemon
  edge expose-function          Expose local function as edge node

Options for 'run':
  --params, -p <json>           Tool parameters as JSON
  --<key> <value>               Pass individual parameters
`);
}
```

**Pattern:** CLI and MCP use same handler registry with `preflight`/`display` hooks.

---

### 2. Client Core (`src/client.ts` Lines 1-465)

#### Request Layer

```typescript
export class RainfallClient {
  private apiKey: string;
  private baseUrl: string = 'https://olympic-api.pragma-digital.org/v1';
  
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, { ... });
        
        // Update rate limit info from headers
        this.lastRateLimitInfo = {
          limit: parseInt(limit, 10),
          remaining: parseInt(remaining, 10),
          resetAt: new Date(parseInt(reset, 10) * 1000),
        };
        
        if (!response.ok) throw parseErrorResponse(response, data);
        
        return data as T;
      } catch (error) {
        // Exponential backoff with jitter
        const delay = retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await this.sleep(delay);
      }
    }
  }
}
```

**Key Features:**
- Automatic retries (default: 3)
- Exponential backoff with jitter
- Rate limit header parsing
- Timeout abort controller

#### Tool Execution

```typescript
async executeTool<T>(toolId: string, params?: Record<string, unknown>, options?: RequestOptions & { 
  skipValidation?: boolean; 
  targetEdge?: string;
}): Promise<T> {
  // Validate params before execution (unless skipped)
  if (!options?.skipValidation) {
    const validation = await this.validateToolParams(toolId, params);
    if (!validation.valid) throw new ValidationError(formatValidationErrors(validation));
  }
  
  // Build request with optional targetEdge for distributed execution
  const body: Record<string, unknown> = params || {};
  if (options?.targetEdge) {
    body._targetEdge = options.targetEdge;
  }
  
  const response = await this.request(
    `/olympic/subscribers/${subscriberId}/nodes/${toolId}`,
    { method: 'POST', body }
  );
  
  return response.result;
}
```

**Execution Modes:**
- `local-only`: Execute on edge node only
- `distributed`: Execute across networked nodes
- `any`: Auto-select best execution mode

---

### 3. SDK Wrapper (`src/sdk.ts` Lines 1-431)

#### Namespace DSL

```typescript
export class Rainfall {
  private client: RainfallClient;
  
  constructor(config: RainfallConfig) {
    this.client = new RainfallClient(config);
  }

  get integrations(): IntegrationsNamespace {
    return createIntegrations(this.client);
  }
  
  get memory(): Memory.MemoryClient { return createMemory(this.client); }
  get articles(): Articles.ArticlesClient { return createArticles(this.client); }
  get web(): Web.WebClient { return createWeb(this.client); }
  get ai(): AI.AIClient { return createAI(this.client); }
  get data(): Data.DataClient { return createData(this.client); }
  get utils(): Utils.UtilsClient { return createUtils(this.client); }
  get charts(): Charts.ChartsClient { return createCharts(this.client); }

  // Low-level access
  async listTools(): Promise<...> { return this.client.listTools(); }
  async getToolSchema(toolId: string): Promise<...> { return this.client.getToolSchema(toolId); }
  async executeTool<T>(toolId, params?, options?) { return this.client.executeTool<T>(...); }
  
  // OpenAI-compatible chat
  async chatCompletions(params: { ... }): Promise<unknown> {
    return this.client.chatCompletions(params);
  }
}
```

#### Namespace Implementation (`src/namespaces/integrations.ts` Lines 1-123)

```typescript
export class IntegrationsNamespace {
  constructor(private client: RainfallClient) {}

  get github(): Integrations.GitHub {
    return {
      issues: {
        create: (params) => this.client.executeTool('github-create-issue', params),
        list: (params) => this.client.executeTool('github-list-issues', params),
        get: (params) => this.client.executeTool('github-get-issue', params),
        update: (params) => this.client.executeTool('github-update-issue', params),
        addComment: (params) => this.client.executeTool('github-add-issue-comment', params),
      },
      repos: { ... },
      pullRequests: { ... },
    };
  }

  get slack(): Integrations.Slack {
    return {
      messages: {
        send: (params) => this.client.executeTool('slack-core-postMessage', params),
        list: (params) => this.client.executeTool('slack-core-listMessages', params),
      },
      channels: { ... },
    };
  }
  
  // Notion, Linear, Figma, Stripe follow same pattern
}
```

**Pattern:** Each integration is a thin wrapper around `executeTool()` with typed interfaces.

---

### 4. CLI Command System

#### Handler Registry (`src/cli/handlers/_registry.ts` Lines 1-271)

```typescript
export interface ToolHandler {
  toolId: string | RegExp;
  
  preflight?: (context: ToolContext) => Promise<PreflightResult>;
  display?: (context: PostflightContext) => Promise<boolean>; // true = handled, skip default
}

const finvizQuotesHandler: ToolHandler = {
  toolId: 'finviz-quotes',
  
  async display(context) {
    const { result, flags } = context;
    
    if (flags.raw) return false; // Use default JSON
    
    const quotes = (result as Record<string, unknown>)?.quotes;
    
    if (Array.isArray(quotes) && quotes.length > 0) {
      console.log(formatAsTable(
        quotes.map(q => ({
          Ticker: q.ticker,
          Price: q.data.Price,
          Change: q.data.Change,
          Volume: q.data.Volume,
          'Market Cap': q.data.MarketCap,
        }))
      ));
      
      if (result.summary) console.log(result.summary);
      return true; // Handled
    }
    
    return false; // Fall through to default
  },
};

const webSearchHandler: ToolHandler = {
  toolId: /web-search|exa-web-search|perplexity/,
  
  async display(context) {
    const { result } = context;
    
    if (result.answer || result.summary) {
      console.log(result.answer || result.summary);
      
      if (result.sources && Array.isArray(result.sources)) {
        console.log('\n--- Sources ---');
        result.sources.forEach((source, i) => {
          console.log(`  ${i + 1}. ${typeof source === 'string' ? source : source.title}`);
        });
      }
      
      return true;
    }
    
    return false;
  },
};
```

**Handler Types:**
- **Preflight**: Transform params before execution (e.g., string→array parsing)
- **Display**: Custom output formatting (tables, markdown, images)

#### CLI Args Parsing

```typescript
// src/cli/core/param-parser.ts
export function parseCliArgs(args: string[]): {
  toolId: string;
  params: Record<string, unknown>;
} {
  const toolId = args.shift();
  
  // --params '{"key": "value"}' or individual flags --key value
  const params: Record<string, unknown> = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--params' || args[i] === '-p') {
      params.json = JSON.parse(args[++i]);
    } else if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      let value = args[++i];
      
      // Type coercion
      if (value.includes(',')) {
        value = value.split(','); // Array
      } else if (!isNaN(Number(value))) {
        value = Number(value); // Number
      } else if (value === 'true') {
        value = true; // Boolean
      } else if (value === 'false') {
        value = false;
      }
      
      params[key] = value;
    }
  }
  
  return { toolId, params };
}
```

---

### 5. Daemon System (`src/daemon/index.ts` Lines 1-2050)

#### Server Initialization

```typescript
export class RainfallDaemon {
  private wss?: WebSocketServer;
  private openaiApp: express.Application;
  
  constructor(config: DaemonConfig = {}) {
    this.port = config.port || 8765;        // WebSocket for MCP clients
    this.openaiPort = config.openaiPort || 8787;  // HTTP OpenAI-compatible
    
    this.networkedExecutor = new RainfallNetworkedExecutor(this.rainfall, {
      wsPort: this.port,
      httpPort: this.openaiPort,
      hostname: process.env.HOSTNAME || 'local-daemon',
    });
    
    this.context = new RainfallDaemonContext(...);
    this.listeners = new RainfallListenerRegistry(...);
    this.mcpProxy = new MCPProxyHub({ debug: this.debug });
  }
  
  async start() {
    // Initialize networked executor
    await this.networkedExecutor.registerEdgeNode();
    await this.networkedExecutor.subscribeToResults((jobId, result, error) => { ... });
    
    // Start polling for jobs to execute
    this.networkedExecutor.startJobPolling(async (toolId, params) => {
      const result = await this.executeLocalTool(toolId, params);
      
      if (this.context) {
        this.context.recordExecution(toolId, params, result, { duration: Date.now() - startTime });
      }
      
      return result;
    });
    
    // Load all available tools
    await this.loadTools();
  }
}
```

#### WebSocket Protocol (MCP-compatible)

```typescript
interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

// Example messages:
// {"jsonrpc":"2.0","method":"tools/list","id":1}
// {"jsonrpc":"2.0","result":{"tools":[...]},"id":1}

// {"jsonrpc":"2.0","method":"tools/call","params":{"name":"finviz-quotes","arguments":{"tickers":["AAPL"]}},"id":2}
// {"jsonrpc":"2.0","result":{"quotes":[...]},"id":2}
```

#### OpenAI-Compatible Endpoint

```typescript
this.openaiApp.post('/v1/chat/completions', async (req, res) => {
  const { subscriber_id, messages, model, tools } = req.body;
  
  // Convert to Rainfall tool call format
  const rainfallTools = tools?.map(t => ({
    type: 'function',
    function: t.function,
  }));
  
  const response = await this.rainfall.chatCompletions({
    subscriber_id,
    messages,
    model,
    tools: rainfallTools,
    stream: req.body.stream || false,
  });
  
  res.json(response);
});
```

---

### 6. Distributed Execution (`src/services/networked.ts` Lines 1-462)

#### Edge Node Registration

```typescript
export class RainfallNetworkedExecutor {
  async registerEdgeNode(): Promise<string> {
    const capabilities = this.buildCapabilitiesList();
    
    // Try to reuse existing edgeNodeId from config
    if (this.options.edgeNodeId) {
      const heartbeatResult = await this.rainfall.executeTool('edge-node-heartbeat', {
        edgeNodeId: this.options.edgeNodeId,
        activeJobs: 0,
        queueDepth: 0,
      });
      
      if (heartbeatResult.success && heartbeatResult.status === 'active') {
        return this.options.edgeNodeId; // Reuse
      }
    }
    
    // Register new edge node
    const result = await this.rainfall.executeTool('register-edge-node', {
      hostname: this.options.hostname,
      capabilities,
      wsPort: this.options.wsPort,
      httpPort: this.options.httpPort,
      version: '0.1.0',
    });
    
    this.edgeNodeId = result.edgeNodeId;
    return this.edgeNodeId;
  }
  
  // Send heartbeat every 60 seconds to keep registration alive
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.rainfall.executeTool('edge-node-heartbeat', {
        edgeNodeId: this.edgeNodeId,
        activeJobs: this.jobCallbacks.size,
        queueDepth: 0,
      });
    }, 60000);
  }
}
```

#### Job Queue

```typescript
async queueToolExecution(
  toolId: string, 
  params: Record<string, unknown>,
  options: { executionMode?: 'local-only' | 'distributed' | 'any'; callback?: (...) => void } = {}
): Promise<string> {
  try {
    const result = await this.rainfall.executeTool('queue-job', {
      toolId,
      params,
      executionMode: options.executionMode || 'any',
      requesterEdgeNodeId: this.edgeNodeId,
    });
    
    if (options.callback) {
      this.jobCallbacks.set(result.jobId, options.callback);
      this.startResultPolling();
    }
    
    return result.jobId;
  } catch (error) {
    // Fallback to local execution if queue not available
    if (executionMode === 'local-only' || executionMode === 'any') {
      const result = await this.rainfall.executeTool(toolId, params);
      options.callback?.(result);
      return `local-${Date.now()}`;
    }
    
    throw error;
  }
}
```

---

### 7. Proc Nodes (Backend Pattern - Rainyday)

#### Proc Node Base Class (`rainyday/lib/proc/services/service-proc-node.js` Lines 1-254)

```javascript
export class ServiceProcNode {
  constructor(service, authConfig, apiConfig, endpointName, endpointConfig) {
    this.service = service;
    this.authConfig = authConfig;        // { variable: 'Authorization', prefix: 'Bearer' }
    this.apiConfig = apiConfig;          // { sdk?: { enabled: true, factory: fn, methodMapping } }
    this.endpointName = endpointName;
    this.endpointConfig = endpointConfig; // { inputMapping: { apiParam: 'inputKey' } }
    
    this.current = {};                   // Input values
    this.result = null;
  }

  async preflight() {
    // Auto-load credentials from database
    if (this.state.subscriber_id) {
      await this.loadCredentials();
    }
    
    // Setup API client based on configuration
    if (this.apiConfig?.sdk?.enabled) {
      await this.setupSDKClient();       // Use Rainfall SDK
    } else {
      await this.setupUbiquityClient();  // Use Ubiquity schema
    }
    
    // Map inputs to API parameters
    this.mapInputsToApiParameters();
  }

  async loadCredentials() {
    const credential = await olympic.serviceCredentials.findByName(
      this.state.subscriber_id,
      this.service,
      this.current.credential_name || 'main'
    );
    
    if (credential?.credential_data) {
      this.credentials = credential.credential_data;
    }
  }

  async setupUbiquityClient() {
    this.api = await ApiBuilder.load(this.service);
    
    // Inject credentials
    if (this.credentials && this.authConfig.variable) {
      const token = this.credentials.token || this.credentials.access_token;
      const authValue = this.authConfig.prefix 
        ? `${this.authConfig.prefix} ${token}`
        : token;
      
      this.api.variables[this.authConfig.variable] = authValue;
    }
  }

  async setupSDKClient() {
    if (!this.apiConfig.sdk?.factory) {
      throw new Error(`SDK factory not configured for ${this.service}`);
    }
    
    this.client = await this.apiConfig.sdk.factory(this.credentials);
  }

  mapInputsToApiParameters() {
    const mapping = this.endpointConfig.inputMapping; // { apiParam: inputKey }
    
    if (this.api) {
      // Ubiquity API
      for (const [apiKey, inputKey] of Object.entries(mapping)) {
        if (this.current[inputKey] !== undefined) {
          this.api.variables[apiKey] = this.current[inputKey];
        }
      }
    } else if (this.client && this.apiConfig.sdk?.methodMapping) {
      // SDK mapping
      this.sdkParams = {};
      for (const [apiKey, inputKey] of Object.entries(mapping)) {
        if (this.current[inputKey] !== undefined) {
          this.sdkParams[apiKey] = this.current[inputKey];
        }
      }
    }
  }

  async execute() {
    try {
      await this.preflight();
      
      // Execute API call
      const result = await this.api.call(
        this.endpointName,
        Object.values(this.sdkParams || {})
      );
      
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
```

#### Proc Node Categories

| Category | Tools | Purpose |
|----------|-------|---------|
| **ai** | Agent, FIM, OCR, Vision, Workflow Generator | Inference and content generation |
| **db** | Articles, Memory, Sources, Scripts, DuckDB | Data persistence and queries |
| **svc** | GitHub, Google, Slack, Notion, Linear, Stripe | External service integrations |
| **tk** (toolkit) | Web, Jina, Security, Utilities | Development tools |
| **tr** (transformation) | Document, Visual, Scheduling | Format conversion and optimization |
| **vm** (virtual machine) | Sandbox | Secure code execution |

---

### 8. PSMs (Payment/Subscription Management)

#### Database Schema

```sql
CREATE TABLE olympic.psms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES olympic.subscribers(id),
  organization_id UUID,
  parent_psm_id UUID REFERENCES olympic.psms(id),  -- Chainable hierarchy
  type TEXT NOT NULL,                               -- PSM type (billing_discounts, billing_fees)
  name TEXT,
  content JSONB NOT NULL,                           -- Schemaless data
  visibility TEXT DEFAULT 'subscriber',             -- subscriber | organization
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

#### PSM Operations (`rainyday/lib/db/src/olympic/psms.js` Lines 1-203)

```javascript
export const psms = {
  // Create with schemaless JSONB content
  create: async (_psm) => {
    const columns = Object.keys(_psm).filter(key => _psm[key] !== undefined && _psm[key] !== null);
    const [psm] = await sql`INSERT INTO olympic.psms ${sql(_psm, columns)} RETURNING *`;
    return { success: true, psm };
  },

  // Load with parent-child tree resolution
  load_as_tree: async (id) => {
    const { success, loaded_psms } = await psms.load(id);
    
    const psm_hash = loaded_psms.reduce((acc, psm) => {
      acc[psm.id] = psm;
      return acc;
    }, {});
    
    // Attach children to parents
    loaded_psms.forEach(psm => {
      if (psm.parent_psm_id) {
        psm_hash[psm.parent_psm_id].children = [
          ...(psm_hash[psm.parent_psm_id].children || []),
          psm
        ];
      }
    });
    
    return { success: true, tree: root_psm };
  },

  // Find by type and content field filtering (JSONB operators)
  findByTypeWithFilters: async (subscriber_id, type, contentFilters = {}) => {
    let query = sql`
      SELECT * FROM olympic.psms
      WHERE deleted_at IS NULL
        AND subscriber_id = ${subscriber_id}
        AND type = ${type}
    `;
    
    // Dynamic JSONB filtering
    for (const [key, value] of Object.entries(contentFilters)) {
      if (typeof value === 'string') {
        query = sql`${query} AND content->>${key} ILIKE ${value}`;
      } else if (typeof value === 'number') {
        query = sql`${query} AND (content->>${key})::numeric = ${value}`;
      }
    }
    
    query = sql`${query} ORDER BY name ASC`;
    
    const psms = await query;
    return { success: true, psms };
  },

  // List types for subscriber
  typesForSubscriber: async (subscriber_id) => {
    const types = await sql`SELECT DISTINCT type FROM olympic.psms WHERE subscriber_id = ${subscriber_id} AND deleted_at IS NULL`;
    return { success: true, types };
  },
};
```

**Usage Pattern:**

```javascript
// Create billing discount PSM
const psmId = await psms.create({
  subscriber_id: '...',
  type: 'billing_discounts',
  name: 'Startup Discount',
  content: {
    percentage: 20,
    duration_months: 6,
    tiers: ['indie', 'startup']
  }
});

// Load as tree
const { success, tree } = await psms.load_as_tree(psmId);
console.log(tree.children); // Nested structure

// Find all billing discounts for tier='startup'
const discounts = await psms.findByTypeWithFilters(
  subscriber_id,
  'billing_discounts',
  { tiers: 'startup' }
);
```

---

### 9. Ubiquity API Builder (Rainyday)

#### Hierarchical Schema Structure

```
lib/ubiquity/src/schemas/
├── github/
│   ├── index.json              # Base config
│   ├── repos/
│   │   └── index.json          # Repos endpoints
│   ├── issues/
│   │   └── index.json          # Issues endpoints
│   └── pull_requests/
│       └── index.json
└── notion/
    ├── index.json
    ├── pages/
    ├── databases/
    └── blocks/
```

#### Base Service Configuration

```json
{
  "name": "github",
  "baseUrl": "https://api.github.com",
  "authentication": {
    "type": "bearer",
    "token": { "key": "GITHUB_TOKEN", "prefix": "Bearer" }
  },
  "proc_node": {
    "category": "svc",
    "auth_type": "api_key",
    "rate_limit": { "requests_per_minute": 60 },
    "icon": "🐙"
  }
}
```

#### Endpoint Configuration

```json
{
  "endpoints": {
    "repos_listForAuthenticatedUser": {
      "method": "GET",
      "path": "/user/repos",
      "authentication": true,
      "description": "List repositories for authenticated user",
      "proc_node": {
        "name": "GitHub List Repositories",
        "category": "svc",
        "inputs": {
          "per_page": { "type": "number", "default": 30 },
          "page": { "type": "number", "default": 1 }
        },
        "outputs": {
          "repos": "array"
        }
      }
    }
  }
}
```

#### Runtime Loading

```javascript
// Load entire API
const githubApi = await ApiBuilder.load('github');

// Load specific category (performance optimization)
const reposApi = await ApiBuilder.load('github', 'repos');
const issuesApi = await ApiBuilder.load('github', 'issues');

// Execute call
const result = await githubApi.call('repos', 'listForAuthenticatedUser', {
  per_page: 10,
  page: 1
});
```

---

## 🔌 INTEGRATION PATTERNS

### OpenAI-Compatible Chat Completions

```typescript
async chatCompletions(params: {
  subscriber_id: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  stream?: boolean;
  temperature?: number;
  tools?: unknown[];
}): Promise<unknown> {
  const { subscriber_id, ...body } = params;
  
  if (body.stream) {
    // Return ReadableStream for SSE
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    
    return response.body;
  }
  
  // Non-streaming request
  return this.request(
    `/olympic/subscribers/${subscriber_id}/v1/chat/completions`,
    { method: 'POST', body }
  );
}
```

### Tool Registry Integration

```typescript
async getRegistryTools(namespacePrefix = 'tools'): Promise<{ 
  success: boolean; 
  tools?: Array<{
    id: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    source: { type: string; metadata: Record<string, unknown> };
    visibility: string;
    updated_at: string;
  }>;
}> {
  return this.request(
    `/olympic/registry/tools?namespace_prefix=${encodeURIComponent(namespacePrefix)}`,
    { method: 'GET' }
  );
}
```

---

## 📦 BUILD & DEPLOYMENT

### Package Configuration (`package.json` Lines 1-87)

```json
{
  "name": "@rainfall-devkit/sdk",
  "version": "0.2.18",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "bin": {
    "rainfall": "./dist/cli/index.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./mcp": {
      "import": "./dist/mcp.mjs",
      "require": "./dist/mcp.js",
      "types": "./dist/mcp.d.ts"
    },
    "./daemon": {
      "import": "./dist/daemon/index.mjs",
      "require": "./dist/daemon/index.js",
      "types": "./dist/daemon/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts src/mcp.ts src/cli/index.ts src/daemon/index.ts --format cjs,esm --dts --shims",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "bun test",
    "lint": "tsc --noEmit",
    "prepublishOnly": "bun run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "express": "^4",
    "libsodium-wrappers-sumo": "^0.8.2",
    "ws": "^8"
  }
}
```

### Build Output

```bash
# Build command
bun run build

# Output structure
dist/
├── index.js          # CommonJS (Node.js)
├── index.mjs         # ES Modules
├── index.d.ts        # TypeScript definitions
├── cli/
│   └── index.js      # CLI entry point
├── daemon/
│   └── index.js      # Daemon entry point
└── mcp.js            # MCP-specific exports
```

---

## 🗄️ DATABASE LAYER (Rainyday)

### Redis Pattern (via BullMQ)

```javascript
// Queue submission
await fetch('/api/v1/ops/queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'submit',
    job_type: 'rss_scraper',
    job_name: 'hackernews-scraper',
    job_metadata: { source_name: 'hackernews' }
  })
});

// Stats
const stats = await fetch('/api/v1/ops/queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'stats' })
});
```

### PostgreSQL Schema

```sql
-- Subscriber authentication
CREATE TABLE olympic.subscribers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  billing_status TEXT,
  metadata JSONB
);

-- Service credentials (auto-discovered by proc nodes)
CREATE TABLE olympic.service_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES olympic.subscribers(id),
  service TEXT NOT NULL,
  credential_name TEXT DEFAULT 'main',
  credential_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PSMs (Payment/Subscription Management)
CREATE TABLE olympic.psms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES olympic.subscribers(id),
  parent_psm_id UUID REFERENCES olympic.psms(id),
  type TEXT NOT NULL,
  name TEXT,
  content JSONB NOT NULL,
  visibility TEXT DEFAULT 'subscriber',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Registry for proc nodes
CREATE TABLE olympic.registries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL,
  source_type TEXT,  -- rainfall | mcp | local | external
  visibility TEXT DEFAULT 'subscriber',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🚀 USAGE EXAMPLES

### SDK Usage

```typescript
import { Rainfall } from '@rainfall-devkit/sdk';

const rainfall = new Rainfall({
  apiKey: process.env.RAINFALL_API_KEY!,
});

// Use integrations
await rainfall.integrations.github.issues.create({
  owner: 'facebook',
  repo: 'react',
  title: 'Bug report',
  body: 'Steps to reproduce...',
});

// Web search
const results = await rainfall.web.search.exa({
  query: 'latest AI chip market news',
  numResults: 5,
});

// Store memory
await rainfall.memory.create({
  content: 'User prefers dark mode',
  keywords: ['preference', 'ui'],
});

// Financial analysis
const candles = await rainfall.charts.finviz.get('AAPL');
const chart = await rainfall.charts.finviz.candlestick('AAPL', {
  width: 100,
  height: 30,
  theme: 'dracula',
});
```

### CLI Usage

```bash
# Authenticate
rainfall auth login <your-api-key>

# List tools
rainfall tools list

# Run with JSON params
rainfall run exa-web-search -p '{"query": "AI news"}'

# Run with individual flags
rainfall run finviz-quotes --tickers AAPL,GOOGL,MSFT

# Daemon mode
rainfall daemon start
```

### MCP Client (Python Example)

```python
import websocket
import json

ws = websocket.WebSocket()
ws.connect("ws://localhost:8765")

# List tools
ws.send(json.dumps({"jsonrpc": "2.0", "method": "tools/list", "id": 1}))
print(ws.recv())

# Call tool
ws.send(json.dumps({
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "finviz-quotes",
    "arguments": {"tickers": ["AAPL", "GOOGL"]}
  },
  "id": 2
}))
print(ws.recv())
```

---

## 📊 ARCHITECTURE SUMMARY

| Component | Lines | Purpose |
|-----------|-------|---------|
| `client.ts` | 465 | HTTP client with retry, rate limiting, validation |
| `sdk.ts` | 431 | Namespace DSL for integrations and tools |
| `cli/index.ts` | 2629 | CLI command handler with 30+ subcommands |
| `daemon/index.ts` | 2050 | WebSocket server + OpenAI-compatible proxy |
| `networked.ts` | 462 | Edge node registration + job queueing |
| `validation.ts` | 306 | Parameter validation with schema caching |

**Total Source:** ~14,225 lines across 56 files (45 TypeScript)

---

## 🎯 KEY DESIGN PATTERNS

### 1. Registry-Driven Tool Discovery
Tools are loaded from registry instead of hardcoded - new tools appear automatically.

### 2. Chainable Schemaless Configs (PSMs)
Hierarchical JSONB with parent-child relationships for complex configurations.

### 3. Dual CLI+MCP Pattern
Single codebase serves both terminal and agent tool interfaces via handler registry.

### 4. Distributed Edge Execution
Queue-based job distribution across multiple edge nodes with auto-fallback.

### 5. Proc Node Abstraction
Uniform interface for all tools (GitHub, Slack, AI, etc.) with credential auto-discovery.

---

**Last Updated:** 2026-04-13  
**Next Sprint:** 1.5 - Acceleration Phase (Codebox Bridge + Starfighter Integration)
