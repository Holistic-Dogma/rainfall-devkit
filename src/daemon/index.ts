/**
 * Rainfall Daemon - Local websocket server + OpenAI-compatible proxy
 * 
 * Provides:
 * - WebSocket server for MCP clients (Claude, Cursor, etc.)
 * - OpenAI-compatible /v1/chat/completions endpoint
 * - Hot-loaded tools from Rainfall SDK
 * - Networked execution for distributed workflows
 * - Persistent context and memory
 * - Passive listeners (file watchers, cron triggers)
 */

import { WebSocketServer, WebSocket } from 'ws';
import express, { Request, Response } from 'express';
import { join } from 'path';
import { Rainfall } from '../sdk.js';
import { RainfallConfig } from '../types.js';
import { RainfallNetworkedExecutor, NetworkedExecutorOptions } from '../services/networked.js';
import { RainfallDaemonContext, ContextOptions } from '../services/context.js';
import { RainfallListenerRegistry } from '../services/listeners.js';
import { MCPProxyHub, MCPClientConfig } from '../services/mcp-proxy.js';
import { TaskPoller, TaskPollerConfig } from '../services/task-poller.js';

// MCP message types
interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// OpenAI-compatible types
interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface LLMCallParams {
  subscriberId: string;
  model?: string;
  messages: ChatCompletionMessage[];
  tools?: unknown[];
  tool_choice?: string | { type: string; function?: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tool_priority?: 'local' | 'rainfall' | 'serverside' | 'stacked';
  enable_stacked?: boolean;
}

interface LLMResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: ToolCall[];
    };
  }>;
  id?: string;
  model?: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: string | { type: string; function?: { name: string } };
  // Rainfall-specific extensions
  conversation_id?: string;
  agent_name?: string;
  incognito?: boolean;
  tool_priority?: 'local' | 'rainfall' | 'serverside' | 'stacked';
  enable_stacked?: boolean;
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LocalFunctionDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface DaemonConfig {
  port?: number;
  openaiPort?: number;
  rainfallConfig?: RainfallConfig;
  /** Enable debug logging */
  debug?: boolean;
  /** Networked executor options */
  networkedOptions?: NetworkedExecutorOptions;
  /** Context/memory options */
  contextOptions?: ContextOptions;
  /** Enable MCP proxy hub (default: true) */
  enableMcpProxy?: boolean;
  /** Namespace prefix for MCP tools (default: true) */
  mcpNamespacePrefix?: boolean;
  /** Pre-configured MCP clients to connect on startup */
  mcpClients?: MCPClientConfig[];
}

export interface DaemonStatus {
  running: boolean;
  port?: number;
  openaiPort?: number;
  toolsLoaded: number;
  localFunctionsLoaded?: number;
  mcpClients?: number;
  mcpTools?: number;
  clientsConnected: number;
  edgeNodeId?: string;
  context: {
    memoriesCached: number;
    activeSessions: number;
    currentSession?: string;
    executionHistorySize: number;
  };
  listeners: {
    fileWatchers: number;
    cronTriggers: number;
    recentEvents: number;
  };
  tasks: {
    isRunning: boolean;
    activeTasks: number;
    maxConcurrent: number;
  };
}

export class RainfallDaemon {
  private wss?: WebSocketServer;
  private openaiApp: express.Application;
  private rainfall?: Rainfall;
  private port: number;
  private openaiPort: number;
  private rainfallConfig?: RainfallConfig;
  private tools: Array<{ id: string; name: string; description: string; category: string }> = [];
  private toolSchemas: Map<string, unknown> = new Map();
  private localFunctions: Map<string, LocalFunctionDefinition> = new Map();
  private clients: Set<WebSocket> = new Set();
  private debug: boolean;

  // New services
  private networkedExecutor?: RainfallNetworkedExecutor;
  private context?: RainfallDaemonContext;
  private listeners?: RainfallListenerRegistry;
  private mcpProxy?: MCPProxyHub;
  private taskPoller?: TaskPoller;
  private enableMcpProxy: boolean;
  private mcpNamespacePrefix: boolean;

  constructor(config: DaemonConfig = {}) {
    this.port = config.port || 8765;
    this.openaiPort = config.openaiPort || 8787;
    this.rainfallConfig = config.rainfallConfig;
    this.debug = config.debug || false;
    this.enableMcpProxy = config.enableMcpProxy ?? true;
    this.mcpNamespacePrefix = config.mcpNamespacePrefix ?? true;
    this.openaiApp = express();
    this.openaiApp.use(express.json());
  }

  async start(): Promise<void> {
    this.log('🌧️  Rainfall Daemon starting...');

    // Initialize Rainfall SDK
    await this.initializeRainfall();
    if (!this.rainfall) {
      throw new Error('Failed to initialize Rainfall SDK');
    }

    // Initialize context (persistent memory)
    this.context = new RainfallDaemonContext(this.rainfall, {
      maxLocalMemories: 1000,
      maxMessageHistory: 100,
      ...this.rainfallConfig,
    });
    await this.context.initialize();

    // Load config to get existing edge node ID
    const { loadConfig, saveConfig } = await import('../cli/config.js');
    const config = loadConfig();

    // Initialize networked executor
    this.networkedExecutor = new RainfallNetworkedExecutor(this.rainfall, {
      wsPort: this.port,
      httpPort: this.openaiPort,
      hostname: process.env.HOSTNAME || 'local-daemon',
      capabilities: {
        localExec: true,
        fileWatch: true,
        passiveListen: true,
      },
      edgeNodeId: config.edgeNodeId, // Pass existing edge node ID from config
      onEdgeNodeRegistered: (edgeNodeId: string) => {
        // Save new edge node ID to config
        config.edgeNodeId = edgeNodeId;
        saveConfig(config);
        this.log(`💾 Saved edge node ID to config: ${edgeNodeId}`);
      },
    });

    // Register edge node with Rainfall backend
    await this.networkedExecutor.registerEdgeNode();

    // Subscribe to job results
    await this.networkedExecutor.subscribeToResults((jobId, result, error) => {
      this.log(`📬 Job ${jobId} ${error ? 'failed' : 'completed'}`, error || result);
    });

    // Start polling for jobs to execute
    this.networkedExecutor.startJobPolling(async (toolId, params) => {
      this.log(`🔧 Executing job: ${toolId}`);
      const startTime = Date.now();
      
      try {
        const result = await this.executeLocalTool(toolId, params);
        const duration = Date.now() - startTime;
        
        // Record execution in context
        if (this.context) {
          this.context.recordExecution(toolId, params, result, { duration });
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Record failed execution
        if (this.context) {
          this.context.recordExecution(toolId, params, null, { error: errorMessage, duration });
        }
        
        throw error;
      }
    });

    // Initialize listener registry
    this.listeners = new RainfallListenerRegistry(
      this.rainfall,
      this.context,
      this.networkedExecutor
    );

    // Load all available tools
    await this.loadTools();

    // Initialize MCP Proxy Hub
    if (this.enableMcpProxy) {
      this.mcpProxy = new MCPProxyHub({ debug: this.debug });
      await this.mcpProxy.initialize();

      // Connect pre-configured MCP clients
      if (this.rainfallConfig?.mcpClients) {
        for (const clientConfig of this.rainfallConfig.mcpClients) {
          try {
            await this.mcpProxy.connectClient(clientConfig);
          } catch (error) {
            this.log(`Failed to connect MCP client ${clientConfig.name}:`, error);
          }
        }
      }
    }

    // Initialize task poller for structured job queue
    this.taskPoller = new TaskPoller(
      this.rainfall,
      this.localFunctions as unknown as Map<string, { execute: (context: unknown) => Promise<Record<string, unknown>> }>,
      {
        pollInterval: 5000,
        maxConcurrent: 3,
        debug: this.debug,
      }
    );
    await this.taskPoller.initialize();
    this.taskPoller.start();
    this.log('📋 Task poller started');

    // Start WebSocket server for MCP
    await this.startWebSocketServer();

    // Start OpenAI-compatible HTTP server
    await this.startOpenAIProxy();

    // Log startup info
    console.log(`🚀 Rainfall daemon running`);
    console.log(`   WebSocket (MCP):     ws://localhost:${this.port}`);
    console.log(`   OpenAI API:          http://localhost:${this.openaiPort}/v1/chat/completions`);
    console.log(`   Health Check:        http://localhost:${this.openaiPort}/health`);
    console.log(`   Edge Node ID:        ${this.networkedExecutor.getEdgeNodeId() || 'local'}`);
    console.log(`   Tools loaded:        ${this.tools.length}`);
    console.log(`   Press Ctrl+C to stop`);

    // Setup graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  async stop(): Promise<void> {
    this.log('🛑 Shutting down Rainfall daemon...');

    // Stop all listeners
    if (this.listeners) {
      await this.listeners.stopAll();
    }

    // Stop job polling
    if (this.networkedExecutor) {
      this.networkedExecutor.stopJobPolling();
    }

    // Stop task poller
    if (this.taskPoller) {
      this.taskPoller.stop();
    }

    // Unregister edge node
    if (this.networkedExecutor) {
      await this.networkedExecutor.unregisterEdgeNode();
    }

    // Shutdown MCP Proxy Hub
    if (this.mcpProxy) {
      await this.mcpProxy.shutdown();
      this.mcpProxy = undefined;
    }

    // Close all WebSocket clients
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    console.log('👋 Rainfall daemon stopped');
  }

  /**
   * Get the networked executor for distributed job management
   */
  getNetworkedExecutor(): RainfallNetworkedExecutor | undefined {
    return this.networkedExecutor;
  }

  /**
   * Get the context for memory/session management
   */
  getContext(): RainfallDaemonContext | undefined {
    return this.context;
  }

  /**
   * Get the listener registry for passive triggers
   */
  getListenerRegistry(): RainfallListenerRegistry | undefined {
    return this.listeners;
  }

  /**
   * Get the MCP Proxy Hub for managing external MCP clients
   */
  getMCPProxy(): MCPProxyHub | undefined {
    return this.mcpProxy;
  }

  /**
   * Connect an MCP client dynamically
   */
  async connectMCPClient(config: MCPClientConfig): Promise<string> {
    if (!this.mcpProxy) {
      throw new Error('MCP Proxy Hub is not enabled');
    }
    return this.mcpProxy.connectClient(config);
  }

  /**
   * Disconnect an MCP client
   */
  async disconnectMCPClient(name: string): Promise<void> {
    if (!this.mcpProxy) {
      throw new Error('MCP Proxy Hub is not enabled');
    }
    return this.mcpProxy.disconnectClient(name);
  }

  private async initializeRainfall(): Promise<void> {
    if (this.rainfallConfig?.apiKey) {
      this.rainfall = new Rainfall(this.rainfallConfig);
    } else {
      // Try to load from config file (same as CLI)
      const { loadConfig } = await import('../cli/config.js');
      const config = loadConfig();
      if (config.apiKey) {
        this.rainfall = new Rainfall({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        });
      } else {
        throw new Error('No API key configured. Run: rainfall auth login <api-key>');
      }
    }
  }

  private async loadTools(): Promise<void> {
    if (!this.rainfall) return;

    try {
      this.tools = await this.rainfall.listTools();
      this.log(`📦 Loaded ${this.tools.length} tools`);
    } catch (error) {
      console.warn('⚠️  Failed to load tools:', error instanceof Error ? error.message : error);
      this.tools = [];
    }
  }

  private async getToolSchema(toolId: string): Promise<unknown> {
    if (this.toolSchemas.has(toolId)) {
      return this.toolSchemas.get(toolId);
    }

    if (!this.rainfall) return null;

    try {
      const schema = await this.rainfall.getToolSchema(toolId);
      this.toolSchemas.set(toolId, schema);
      return schema;
    } catch {
      return null;
    }
  }

  private async startWebSocketServer(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.log('🟢 MCP client connected');
      this.clients.add(ws);

      ws.on('message', async (data: Buffer) => {
        try {
          const message: MCPMessage = JSON.parse(data.toString());
          const response = await this.handleMCPMessage(message);
          ws.send(JSON.stringify(response));
        } catch (error) {
          const errorResponse: MCPMessage = {
            jsonrpc: '2.0',
            id: undefined,
            error: {
              code: -32700,
              message: error instanceof Error ? error.message : 'Parse error',
            },
          };
          ws.send(JSON.stringify(errorResponse));
        }
      });

      ws.on('close', () => {
        this.log('🔴 MCP client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  private async handleMCPMessage(message: MCPMessage): Promise<MCPMessage> {
    const { id, method, params } = message;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: true },
            },
            serverInfo: {
              name: 'rainfall-daemon',
              version: '0.1.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: await this.getMCPTools(),
          },
        };

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolParams = params?.arguments as Record<string, unknown>;
        
        try {
          const startTime = Date.now();
          const result = await this.executeToolWithMCP(toolName, toolParams);
          const duration = Date.now() - startTime;

          // Record execution in context
          if (this.context) {
            this.context.recordExecution(toolName, toolParams || {}, result, { duration });
          }

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';
          
          // Record failed execution
          if (this.context) {
            this.context.recordExecution(toolName, toolParams || {}, null, { 
              error: errorMessage,
              duration: 0,
            });
          }

          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: errorMessage,
            },
          };
        }
      }

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  }

  private async getMCPTools(): Promise<unknown[]> {
    const mcpTools: unknown[] = [];

    // Add local functions first
    for (const localFn of this.localFunctions.values()) {
      mcpTools.push({
        name: localFn.name,
        description: localFn.description,
        inputSchema: localFn.schema,
      });
    }

    // Add Rainfall tools
    for (const tool of this.tools) {
      const schema = await this.getToolSchema(tool.id);
      if (schema) {
        const toolSchema = schema as { 
          name?: string; 
          description?: string; 
          parameters?: Record<string, unknown>;
        };
        mcpTools.push({
          name: tool.id,
          description: toolSchema.description || tool.description,
          inputSchema: toolSchema.parameters || { type: 'object', properties: {} },
        });
      }
    }

    // Add MCP proxy tools with namespace prefix
    if (this.mcpProxy) {
      const proxyTools = this.mcpProxy.getAllTools({ namespacePrefix: this.mcpNamespacePrefix });
      for (const tool of proxyTools) {
        mcpTools.push({
          name: this.mcpNamespacePrefix ? `${tool.serverName}-${tool.name}` : tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
    }

    return mcpTools;
  }

  private async executeTool(toolId: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.rainfall) {
      throw new Error('Rainfall SDK not initialized');
    }

    return this.rainfall.executeTool(toolId, params);
  }

  /**
   * Execute a tool, trying local functions first, then MCP proxy, then Rainfall tools
   */
  private async executeToolWithMCP(
    toolName: string, 
    params?: Record<string, unknown>
  ): Promise<unknown> {
    // First, try local functions
    const localFn = this.localFunctions.get(toolName);
    if (localFn) {
      return localFn.execute(params || {});
    }

    // Next, try to execute via MCP proxy if enabled
    if (this.mcpProxy) {
      try {
        // Check if this is a namespaced tool (e.g., "chrome-take_screenshot")
        if (this.mcpNamespacePrefix && toolName.includes('-')) {
          const namespace = toolName.split('-')[0];
          const actualToolName = toolName.slice(namespace.length + 1);
          
          // Check if this namespace exists in MCP proxy
          if (this.mcpProxy.getClient(namespace)) {
            return await this.mcpProxy.callTool(toolName, params || {}, {
              namespace,
            });
          }
        }
        
        // Try without namespace
        return await this.mcpProxy.callTool(toolName, params || {});
      } catch (error) {
        // If tool not found in MCP proxy, fall through to Rainfall tools
        if (error instanceof Error && !error.message.includes('not found')) {
          throw error;
        }
      }
    }

    // Fall back to Rainfall tool execution
    return this.executeTool(toolName, params);
  }

  private async startOpenAIProxy(): Promise<void> {
    // List models endpoint - proxy to Rainyday backend
    this.openaiApp.get('/v1/models', async (_req: Request, res: Response) => {
      try {
        // Try to fetch models from Rainyday backend
        if (this.rainfall) {
          const models = await this.rainfall.listModels();
          res.json({
            object: 'list',
            data: models.map((m: { id: string }) => ({
              id: m.id,
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'rainfall',
            })),
          });
        } else {
          // Fallback to default models
          res.json({
            object: 'list',
            data: [
              { id: 'llama-3.3-70b-versatile', object: 'model', created: Date.now(), owned_by: 'groq' },
              { id: 'gpt-4o', object: 'model', created: Date.now(), owned_by: 'openai' },
              { id: 'claude-3-5-sonnet', object: 'model', created: Date.now(), owned_by: 'anthropic' },
              { id: 'gemini-2.0-flash-exp', object: 'model', created: Date.now(), owned_by: 'gemini' },
            ],
          });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch models' });
      }
    });

    // Chat completions endpoint - with local tool execution loop
    this.openaiApp.post('/v1/chat/completions', async (req: Request, res: Response) => {
      const body: ChatCompletionRequest = req.body;

      // Validate request
      if (!body.messages || !Array.isArray(body.messages)) {
        res.status(400).json({
          error: {
            message: 'Missing required field: messages',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      if (!this.rainfall) {
        res.status(503).json({
          error: {
            message: 'Rainfall SDK not initialized',
            type: 'service_unavailable',
          },
        });
        return;
      }

      try {
        // Get subscriber ID from SDK
        const me = await this.rainfall.getMe();
        const subscriberId = me.id;

        // Build local tool map for quick lookup (for execution)
        const localToolMap = await this.buildLocalToolMap();

        // Only include Rainfall tools if the client explicitly requests tools
        // or if no tools are provided but tool_choice is set
        let allTools: unknown[] = [];
        if (body.tools && body.tools.length > 0) {
          // Client provided tools - use them as-is
          allTools = body.tools;
        } else if (body.tool_choice) {
          // Client wants tool use but didn't provide tools - give them our tools
          const openaiTools = await this.getOpenAITools();
          allTools = openaiTools;
        }
        // else: no tools requested, don't send any

        // Track messages for the conversation (mutable for tool loop)
        let messages = [...body.messages];
        const maxToolIterations = 10; // Prevent infinite loops
        let toolIterations = 0;

        // Tool execution loop
        while (toolIterations < maxToolIterations) {
          toolIterations++;

          // Call the LLM (backend or local)
          const llmResponse = await this.callLLM({
            subscriberId,
            model: body.model,
            messages,
            tools: allTools.length > 0 ? allTools : undefined,
            tool_choice: body.tool_choice,
            temperature: body.temperature,
            max_tokens: body.max_tokens,
            stream: false, // Always non-streaming for tool loop
            tool_priority: body.tool_priority,
            enable_stacked: body.enable_stacked,
          });

          // Check if the model wants to call tools
          const choice = llmResponse.choices?.[0];
          let toolCalls = choice?.message?.tool_calls || [];

          // Also check for XML-style tool calls in content (some models like Qwen do this)
          const content = choice?.message?.content || '';
          const reasoningContent = (choice?.message as { reasoning_content?: string })?.reasoning_content || '';
          const fullContent = content + ' ' + reasoningContent;

          // Parse XML-style tool calls: <function=name><parameter=key>value</parameter></function>
          const xmlToolCalls = this.parseXMLToolCalls(fullContent);
          if (xmlToolCalls.length > 0) {
            this.log(`📋 Parsed ${xmlToolCalls.length} XML tool calls from content`);
            toolCalls = xmlToolCalls;
          }

          if (!toolCalls || toolCalls.length === 0) {
            // No tool calls - return the final response
            if (body.stream) {
              // For streaming requests, we already have the response
              // But since we did non-streaming for the loop, convert to stream format
              await this.streamResponse(res, llmResponse);
            } else {
              res.json(llmResponse);
            }

            // Update context
            this.updateContext(body.messages, llmResponse);
            return;
          }

          // Model wants to call tools - add assistant message with tool_calls
          messages.push({
            role: 'assistant',
            content: choice?.message?.content || '',
            tool_calls: toolCalls as ToolCall[],
          });

          // Execute each tool call
          for (const toolCall of toolCalls as ToolCall[]) {
            const toolName = toolCall.function?.name;
            const toolArgsStr = toolCall.function?.arguments || '{}';
            
            if (!toolName) continue;

            this.log(`🔧 Tool call: ${toolName}`);

            let toolResult: unknown;
            let toolError: string | undefined;

            try {
              // Check if this is a local Rainfall tool
              const localTool = this.findLocalTool(toolName, localToolMap);
              
              if (localTool) {
                // Execute locally
                this.log(`  → Executing locally`);
                const args = JSON.parse(toolArgsStr);
                toolResult = await this.executeLocalTool(localTool.id, args);
              } else if (this.mcpProxy) {
                // Try MCP proxy (handles namespaced tools like chrome_take_screenshot)
                this.log(`  → Trying MCP proxy`);
                const args = JSON.parse(toolArgsStr);
                toolResult = await this.executeToolWithMCP(toolName.replace(/_/g, '-'), args);
              } else {
                // Check if backend should handle it (has [priority:local] marker?)
                const shouldExecuteLocal = body.tool_priority === 'local' || 
                                           body.tool_priority === 'stacked';
                
                if (shouldExecuteLocal) {
                  // Try to execute as a Rainfall tool even if not in our map
                  // (might be a new tool or edge tool)
                  try {
                    const args = JSON.parse(toolArgsStr);
                    toolResult = await this.rainfall!.executeTool(toolName.replace(/_/g, '-'), args);
                  } catch {
                    // Fall back to letting backend handle it
                    toolResult = { _pending: true, tool: toolName, args: toolArgsStr };
                  }
                } else {
                  // Let backend handle remote tools
                  toolResult = { _pending: true, tool: toolName, args: toolArgsStr };
                }
              }
            } catch (error) {
              toolError = error instanceof Error ? error.message : String(error);
              this.log(`  → Error: ${toolError}`);
            }

            // Add tool result to messages
            messages.push({
              role: 'tool',
              content: toolError 
                ? JSON.stringify({ error: toolError })
                : typeof toolResult === 'string' 
                  ? toolResult 
                  : JSON.stringify(toolResult),
              tool_call_id: toolCall.id,
            });

            // Record execution in context
            if (this.context) {
              this.context.recordExecution(
                toolName,
                JSON.parse(toolArgsStr || '{}'),
                toolResult,
                { error: toolError, duration: 0 }
              );
            }
          }
        }

        // Max iterations reached - return current state
        res.status(500).json({
          error: {
            message: 'Maximum tool execution iterations reached',
            type: 'tool_execution_error',
          },
        });

      } catch (error) {
        this.log('Chat completions error:', error);
        res.status(500).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal server error',
            type: 'internal_error',
          },
        });
      }
    });

    // Health check endpoint
    this.openaiApp.get('/health', (_req: Request, res: Response) => {
      const mcpStats = this.mcpProxy?.getStats();
      res.json({
        status: 'ok',
        daemon: 'rainfall',
        version: '0.2.0',
        tools_loaded: this.tools.length,
        local_functions: Array.from(this.localFunctions.keys()),
        mcp_clients: mcpStats?.totalClients || 0,
        mcp_tools: mcpStats?.totalTools || 0,
        edge_node_id: this.networkedExecutor?.getEdgeNodeId(),
        clients_connected: this.clients.size,
      });
    });

    // MCP proxy endpoints
    this.openaiApp.get('/v1/mcp/clients', (_req: Request, res: Response) => {
      if (!this.mcpProxy) {
        res.status(503).json({ error: 'MCP proxy not enabled' });
        return;
      }
      res.json(this.mcpProxy.listClients());
    });

    this.openaiApp.post('/v1/mcp/connect', async (req: Request, res: Response) => {
      if (!this.mcpProxy) {
        res.status(503).json({ error: 'MCP proxy not enabled' });
        return;
      }
      try {
        const name = await this.mcpProxy.connectClient(req.body);
        res.json({ success: true, client: name });
      } catch (error) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Failed to connect MCP client' 
        });
      }
    });

    this.openaiApp.post('/v1/mcp/disconnect', async (req: Request, res: Response) => {
      if (!this.mcpProxy) {
        res.status(503).json({ error: 'MCP proxy not enabled' });
        return;
      }
      const { name } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Missing required field: name' });
        return;
      }
      await this.mcpProxy.disconnectClient(name);
      res.json({ success: true });
    });

    // Admin endpoint: load a local function
    this.openaiApp.post('/admin/load-local-function', async (req: Request, res: Response) => {
      const { filePath, name, description, schema } = req.body;

      if (!filePath || !name) {
        res.status(400).json({ error: 'Missing required fields: filePath, name' });
        return;
      }

      try {
        await this.loadLocalFunction(filePath, name, description, schema);
        res.json({ success: true, name, loaded: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    });

    // Status endpoint with full daemon info
    this.openaiApp.get('/status', (_req: Request, res: Response) => {
      res.json(this.getStatus());
    });

    // Execute tool directly (for local functions and Rainfall tools)
    this.openaiApp.post('/v1/execute', async (req: Request, res: Response) => {
      const { tool_id, params } = req.body;

      if (!tool_id) {
        res.status(400).json({ error: 'Missing required field: tool_id' });
        return;
      }

      if (!this.rainfall) {
        res.status(503).json({ error: 'Rainfall SDK not initialized' });
        return;
      }

      try {
        const result = await this.executeLocalTool(tool_id, params || {});
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Tool execution failed'
        });
      }
    });

    // Queue job endpoint for distributed execution
    this.openaiApp.post('/v1/queue', async (req: Request, res: Response) => {
      const { tool_id, params, execution_mode = 'any' } = req.body;

      if (!tool_id) {
        res.status(400).json({ error: 'Missing required field: tool_id' });
        return;
      }

      if (!this.networkedExecutor) {
        res.status(503).json({ error: 'Networked executor not available' });
        return;
      }

      try {
        const jobId = await this.networkedExecutor.queueToolExecution(
          tool_id,
          params || {},
          { executionMode: execution_mode }
        );
        res.json({ job_id: jobId, status: 'queued' });
      } catch (error) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Failed to queue job' 
        });
      }
    });

    return new Promise((resolve) => {
      this.openaiApp.listen(this.openaiPort, () => {
        resolve();
      });
    });
  }

  /**
   * Build a map of local Rainfall tools for quick lookup
   * Maps OpenAI-style underscore names to Rainfall tool IDs
   */
  private async buildLocalToolMap(): Promise<Map<string, { id: string; name: string; description: string }>> {
    const map = new Map<string, { id: string; name: string; description: string }>();
    
    for (const tool of this.tools) {
      const openAiName = tool.id.replace(/-/g, '_');
      map.set(openAiName, {
        id: tool.id,
        name: openAiName,
        description: tool.description,
      });
      // Also map the original ID for exact matches
      map.set(tool.id, {
        id: tool.id,
        name: openAiName,
        description: tool.description,
      });
    }
    
    return map;
  }

  /**
   * Find a local Rainfall tool by name (OpenAI underscore format or original)
   */
  private findLocalTool(
    toolName: string, 
    localToolMap: Map<string, { id: string; name: string; description: string }>
  ): { id: string; name: string; description: string } | undefined {
    // Try exact match first
    if (localToolMap.has(toolName)) {
      return localToolMap.get(toolName);
    }
    
    // Try with underscores converted to dashes
    const dashedName = toolName.replace(/_/g, '-');
    if (localToolMap.has(dashedName)) {
      return localToolMap.get(dashedName);
    }
    
    return undefined;
  }

  /**
   * Load a local function module from disk
   */
  async loadLocalFunction(
    filePath: string, 
    expectedName?: string,
    providedDescription?: string,
    providedSchema?: Record<string, unknown>
  ): Promise<LocalFunctionDefinition> {
    if (!this.rainfall) {
      throw new Error('Rainfall SDK not initialized');
    }

    const { resolve } = await import('path');
    const { existsSync } = await import('fs');
    const { execSync } = await import('child_process');
    const { mkdtempSync, writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');

    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    let jsPath = resolvedPath;

    // If it's a TypeScript file, transpile it with bun
    if (resolvedPath.endsWith('.ts')) {
      const tempDir = mkdtempSync(join(tmpdir(), 'rainfall-local-'));
      jsPath = join(tempDir, 'function.js');
      try {
        execSync(`bun build "${resolvedPath}" --outfile "${jsPath}" --target node`, {
          stdio: 'pipe',
          timeout: 30000,
        });
      } catch (error) {
        throw new Error(`Failed to transpile ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Clear require cache so reloads pick up changes
    delete require.cache[require.resolve(jsPath)];
    const module = require(jsPath);
    const factory = module.default || module;

    if (typeof factory !== 'function') {
      throw new Error(`Module at ${resolvedPath} must export a default function`);
    }

    const definition = factory({ rainfall: this.rainfall });

    if (!definition || typeof definition !== 'object') {
      throw new Error(`Factory must return an object with { name, description, schema, execute }`);
    }

    const { name, description, schema, execute } = definition;

    if (!name || typeof name !== 'string') {
      throw new Error(`Local function must have a string 'name'`);
    }

    if (expectedName && name !== expectedName) {
      throw new Error(`Function name mismatch: expected "${expectedName}", got "${name}"`);
    }

    // Use provided description/schema if available (from CLI), otherwise use from module
    const finalDescription = providedDescription || description;
    const finalSchema = providedSchema || schema;

    if (!finalDescription || typeof finalDescription !== 'string') {
      throw new Error(`Local function must have a string 'description'`);
    }

    if (!finalSchema || typeof finalSchema !== 'object') {
      throw new Error(`Local function must have an object 'schema'`);
    }

    if (typeof execute !== 'function') {
      throw new Error(`Local function must have an 'execute' function`);
    }

    const localFn: LocalFunctionDefinition = { 
      name, 
      description: finalDescription, 
      schema: finalSchema, 
      execute 
    };
    this.localFunctions.set(name, localFn);

    // Register this function as a proc node with the backend
    if (this.networkedExecutor) {
      try {
        await this.networkedExecutor.registerProcNodes([name]);
        this.log(`🌐 Registered local function as proc node: ${name}`);
      } catch (error) {
        this.log(`⚠️ Failed to register proc node for ${name}:`, error);
      }
    }

    this.log(`📦 Loaded local function: ${name}`);
    return localFn;
  }

  /**
   * Execute a local Rainfall tool
   */
  private async executeLocalTool(toolId: string, args: Record<string, unknown>): Promise<unknown> {
    // Check local functions first
    const localFn = this.localFunctions.get(toolId);
    if (localFn) {
      const startTime = Date.now();
      this.log(`  → Executing local function: ${toolId}`);
      this.log(`    Args: ${JSON.stringify(args)}`);
      try {
        const result = await localFn.execute(args);
        const duration = Date.now() - startTime;
        this.log(`  ✓ Local function ${toolId} completed in ${duration}ms`);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.log(`  ✗ Local function ${toolId} failed after ${duration}ms`);
        throw error;
      }
    }

    if (!this.rainfall) {
      throw new Error('Rainfall SDK not initialized');
    }

    const startTime = Date.now();
    try {
      const result = await this.rainfall.executeTool(toolId, args);
      const duration = Date.now() - startTime;
      this.log(`  ✓ Completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`  ✗ Failed after ${duration}ms`);
      throw error;
    }
  }

  /**
   * Parse XML-style tool calls from model output
   * Handles formats like: <function=name><parameter=key>value</parameter></function>
   */
  private parseXMLToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Match <function=name>...</function> blocks
    const functionRegex = /<function=([^>]+)>([\s\S]*?)<\/function>/gi;
    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      const functionName = match[1].trim();
      const paramsBlock = match[2];

      // Parse parameters: <parameter=key>value</parameter>
      const params: Record<string, unknown> = {};
      const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
      let paramMatch;

      while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
        const paramName = paramMatch[1].trim();
        const paramValue = paramMatch[2].trim();
        params[paramName] = paramValue;
      }

      // Create a tool call
      toolCalls.push({
        id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: 'function',
        function: {
          name: functionName,
          arguments: JSON.stringify(params),
        },
      });

      this.log(`📋 Parsed XML tool call: ${functionName}(${JSON.stringify(params)})`);
    }

    return toolCalls;
  }

  /**
   * Call the LLM via Rainfall backend, LM Studio, RunPod, or other providers
   * 
   * Provider priority:
   * 1. Config file (llm.provider, llm.baseUrl)
   * 2. Environment variables (OPENAI_API_KEY, OLLAMA_HOST, etc.)
   * 3. Default to Rainfall (credits-based)
   */
  private async callLLM(params: LLMCallParams): Promise<LLMResponse> {
    if (!this.rainfall) {
      throw new Error('Rainfall SDK not initialized');
    }

    // Load config to determine provider
    const { loadConfig, getProviderBaseUrl } = await import('../cli/config.js');
    const config = loadConfig();
    const provider = config.llm?.provider || 'rainfall';

    // Route to appropriate provider
    switch (provider) {
      case 'local':
      case 'ollama':
      case 'custom':
        return this.callLocalLLM(params, config);
      
      case 'openai':
      case 'anthropic':
        // Use OpenAI/Anthropic API directly (OpenAI-compatible)
        return this.callExternalLLM(params, config, provider);
      
      case 'rainfall':
      default:
        // Use Rainfall backend (credits-based)
        return this.rainfall.chatCompletions({
          subscriber_id: params.subscriberId,
          model: params.model,
          messages: params.messages as Array<{ role: string; content: string; name?: string }>,
          stream: params.stream || false,
          temperature: params.temperature,
          max_tokens: params.max_tokens,
          tools: params.tools,
          tool_choice: params.tool_choice,
          tool_priority: params.tool_priority,
          enable_stacked: params.enable_stacked,
        }) as Promise<{ choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }> }>;
    }
  }

  /**
   * Call external LLM provider (OpenAI, Anthropic) via their OpenAI-compatible APIs
   */
  private async callExternalLLM(
    params: LLMCallParams,
    config: { llm?: { baseUrl?: string; apiKey?: string; model?: string } },
    provider: 'openai' | 'anthropic'
  ): Promise<LLMResponse> {
    const { getProviderBaseUrl } = await import('../cli/config.js');
    const baseUrl = config.llm?.baseUrl || getProviderBaseUrl({ llm: { provider: provider as 'openai' | 'anthropic' | 'ollama' | 'local' | 'rainfall' } });
    const apiKey = config.llm?.apiKey;
    
    if (!apiKey) {
      throw new Error(`${provider} API key not configured. Set via: rainfall config set llm.apiKey <key>`);
    }

    const model = params.model || config.llm?.model || (provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o');

    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Rainfall-DevKit/1.0',
      },
      body: JSON.stringify({
        model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        stream: false, // Tool loop requires non-streaming
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${provider} API error: ${error}`);
    }

    return response.json() as Promise<LLMResponse>;
  }

  /**
   * Call a local LLM (LM Studio, Ollama, etc.)
   */
  private async callLocalLLM(
    params: LLMCallParams,
    config: { llm?: { baseUrl?: string; apiKey?: string; model?: string } }
  ): Promise<LLMResponse> {
    const baseUrl = config.llm?.baseUrl || 'http://localhost:1234/v1';
    const apiKey = config.llm?.apiKey || 'not-needed';
    const model = params.model || config.llm?.model || 'local-model';

    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Rainfall-DevKit/1.0',
      },
      body: JSON.stringify({
        model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        stream: false, // Tool loop requires non-streaming
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local LLM error: ${error}`);
    }

    return response.json() as Promise<LLMResponse>;
  }

  /**
   * Stream a response to the client (converts non-streaming to SSE format)
   */
  private async streamResponse(res: Response, response: LLMResponse): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const message = response.choices?.[0]?.message;
    const id = response.id || `chatcmpl-${Date.now()}`;
    const model = response.model || 'unknown';
    const created = Math.floor(Date.now() / 1000);

    // Send role chunk
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })}\n\n`);

    // Send content in chunks (simulate streaming)
    const content = message?.content || '';
    const chunkSize = 10;
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
      })}\n\n`);
    }

    // Send finish
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();
  }

  /**
   * Update context with conversation history
   */
  private updateContext(
    originalMessages: ChatCompletionMessage[],
    response: { choices?: Array<{ message?: { content?: string } }> }
  ): void {
    if (!this.context) return;

    // Add last user message
    const lastUserMessage = originalMessages.filter(m => m.role === 'user').pop();
    if (lastUserMessage) {
      this.context.addMessage('user', lastUserMessage.content);
    }

    // Add assistant response
    const assistantContent = response.choices?.[0]?.message?.content;
    if (assistantContent) {
      this.context.addMessage('assistant', assistantContent);
    }
  }

  private async getOpenAITools(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];

    // Add Rainfall tools (limit to first 100 to leave room for MCP tools)
    for (const tool of this.tools.slice(0, 100)) {
      const schema = await this.getToolSchema(tool.id);
      if (schema) {
        const toolSchema = schema as {
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        };

        // Ensure parameters have the correct OpenAI format with all required fields
        let parameters: Record<string, unknown> = { type: 'object', properties: {}, required: [] };

        if (toolSchema.parameters && typeof toolSchema.parameters === 'object') {
          const rawParams = toolSchema.parameters as Record<string, unknown>;
          parameters = {
            type: rawParams.type || 'object',
            properties: rawParams.properties || {},
            required: rawParams.required || [],
          };
        }

        tools.push({
          type: 'function',
          function: {
            name: tool.id.replace(/-/g, '_'), // OpenAI requires underscore names
            description: toolSchema.description || tool.description,
            parameters,
          },
        });
      }
    }

    // Add MCP proxy tools with namespace prefix
    if (this.mcpProxy) {
      const proxyTools = this.mcpProxy.getAllTools({ namespacePrefix: this.mcpNamespacePrefix });
      for (const tool of proxyTools.slice(0, 28)) { // Limit to 28 MCP tools (100 + 28 = 128)
        const inputSchema = tool.inputSchema as Record<string, unknown> || {};
        tools.push({
          type: 'function',
          function: {
            name: this.mcpNamespacePrefix 
              ? `${tool.serverName}_${tool.name}`.replace(/-/g, '_')
              : tool.name.replace(/-/g, '_'),
            description: `[${tool.serverName}] ${tool.description}`,
            parameters: {
              type: 'object',
              properties: (inputSchema.properties as Record<string, unknown>) || {},
              required: (inputSchema.required as string[]) || [],
            },
          },
        });
      }
    }

    return tools;
  }

  private buildResponseContent(): string {
    const edgeNodeId = this.networkedExecutor?.getEdgeNodeId();
    const toolCount = this.tools.length;
    
    return `Rainfall daemon online. Edge node: ${edgeNodeId || 'local'}. ${toolCount} tools available. What would you like to execute locally or in the cloud?`;
  }

  getStatus(): DaemonStatus {
    return {
      running: !!this.wss,
      port: this.port,
      openaiPort: this.openaiPort,
      toolsLoaded: this.tools.length,
      localFunctionsLoaded: this.localFunctions.size,
      clientsConnected: this.clients.size,
      edgeNodeId: this.networkedExecutor?.getEdgeNodeId(),
      context: this.context?.getStatus() || {
        memoriesCached: 0,
        activeSessions: 0,
        executionHistorySize: 0,
      },
      listeners: this.listeners?.getStatus() || {
        fileWatchers: 0,
        cronTriggers: 0,
        recentEvents: 0,
      },
      tasks: this.taskPoller?.getStatus() || {
        isRunning: false,
        activeTasks: 0,
        maxConcurrent: 3,
      },
    };
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }
}

// Singleton instance for CLI usage
let daemonInstance: RainfallDaemon | null = null;

export async function startDaemon(config: DaemonConfig = {}): Promise<RainfallDaemon> {
  if (daemonInstance) {
    console.log('Daemon already running');
    return daemonInstance;
  }

  daemonInstance = new RainfallDaemon(config);
  await daemonInstance.start();
  return daemonInstance;
}

export async function stopDaemon(): Promise<void> {
  if (!daemonInstance) {
    console.log('Daemon not running');
    return;
  }

  await daemonInstance.stop();
  daemonInstance = null;
}

export function getDaemonStatus(): DaemonStatus | null {
  if (!daemonInstance) {
    return null;
  }
  return daemonInstance.getStatus();
}

export function getDaemonInstance(): RainfallDaemon | null {
  return daemonInstance;
}

// Re-export MCP types for convenience
export { MCPProxyHub, MCPClientConfig, MCPTransportType, MCPClientInfo, MCPToolInfo } from '../services/mcp-proxy.js';
