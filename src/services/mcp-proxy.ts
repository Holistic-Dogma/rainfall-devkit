/**
 * MCP Proxy Hub - Manages external MCP clients (Chrome DevTools, etc.)
 * 
 * This service allows the Rainfall daemon to act as a central MCP hub:
 * - External MCP servers (like Chrome DevTools) connect via WebSocket or stdio
 * - Their tools are exposed as native Rainfall tools with optional namespacing
 * - Tool calls are proxied back to the appropriate MCP client
 * - Multiple clients can connect simultaneously with unique namespaces
 */

import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// MCP client connection types
export type MCPTransportType = 'stdio' | 'websocket' | 'http';

export interface MCPClientConfig {
  name: string;
  transport: MCPTransportType;
  // For stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For HTTP/WebSocket transport
  url?: string;
  headers?: Record<string, string>;
  // Auto-connect on daemon start
  autoConnect?: boolean;
}

export interface MCPClientInfo {
  name: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport | WebSocket;
  transportType: MCPTransportType;
  tools: MCPToolInfo[];
  connectedAt: string;
  lastUsed: string;
  config: MCPClientConfig;
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  serverName: string;
}

export interface MCPProxyOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-reconnect disconnected clients */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Tool call timeout in ms */
  toolTimeout?: number;
  /** Refresh interval for tool lists in ms */
  refreshInterval?: number;
}

export class MCPProxyHub {
  private clients = new Map<string, MCPClientInfo>();
  private options: Required<MCPProxyOptions>;
  private refreshTimer?: NodeJS.Timeout;
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private requestId = 0;

  constructor(options: MCPProxyOptions = {}) {
    this.options = {
      debug: options.debug ?? false,
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 5000,
      toolTimeout: options.toolTimeout ?? 30000,
      refreshInterval: options.refreshInterval ?? 30000,
    };
  }

  /**
   * Initialize the MCP proxy hub
   */
  async initialize(): Promise<void> {
    this.log('🔌 Initializing MCP Proxy Hub...');
    this.startRefreshTimer();
    this.log('✅ MCP Proxy Hub initialized');
  }

  /**
   * Shutdown the MCP proxy hub and disconnect all clients
   */
  async shutdown(): Promise<void> {
    this.log('🛑 Shutting down MCP Proxy Hub...');

    // Clear timers
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    // Clear reconnect timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    // Disconnect all clients
    const disconnectPromises = Array.from(this.clients.entries()).map(
      async ([name, client]) => {
        try {
          await this.disconnectClient(name);
        } catch (error) {
          this.log(`Error disconnecting ${name}:`, error);
        }
      }
    );

    await Promise.allSettled(disconnectPromises);
    this.clients.clear();
    this.log('👋 MCP Proxy Hub shut down');
  }

  /**
   * Connect to an MCP server
   */
  async connectClient(config: MCPClientConfig): Promise<string> {
    const { name, transport } = config;

    // Disconnect existing client with same name if present
    if (this.clients.has(name)) {
      this.log(`Reconnecting client: ${name}`);
      await this.disconnectClient(name);
    }

    this.log(`Connecting to MCP server: ${name} (${transport})...`);

    try {
      const client = new Client(
        {
          name: `rainfall-daemon-${name}`,
          version: '0.2.0',
        },
        {
          capabilities: {},
        }
      );

      // Set up error handling
      let lastErrorTime = 0;
      client.onerror = (error) => {
        const now = Date.now();
        if (now - lastErrorTime > 5000) {
          this.log(`MCP Server Error (${name}):`, error.message);
          lastErrorTime = now;
        }
        if (this.options.autoReconnect) {
          this.scheduleReconnect(name, config);
        }
      };

      let transportInstance: StdioClientTransport | StreamableHTTPClientTransport | WebSocket;

      if (transport === 'stdio' && config.command) {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({ ...process.env, ...config.env })) {
          if (value !== undefined) {
            env[key] = value;
          }
        }
        transportInstance = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env,
        });
      } else if (transport === 'http' && config.url) {
        transportInstance = new StreamableHTTPClientTransport(
          new URL(config.url),
          {
            requestInit: {
              headers: config.headers,
            },
          }
        );
      } else if (transport === 'websocket' && config.url) {
        // WebSocket transport - connect to external MCP server
        transportInstance = new WebSocket(config.url);
        await new Promise<void>((resolve, reject) => {
          (transportInstance as WebSocket).on('open', () => resolve());
          (transportInstance as WebSocket).on('error', reject);
          setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
        });
      } else {
        throw new Error(`Invalid transport configuration for ${name}`);
      }

      await client.connect(transportInstance as any);

      // Fetch tools
      const toolsResult = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      );

      const tools: MCPToolInfo[] = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
        serverName: name,
      }));

      // Store client info
      const clientInfo: MCPClientInfo = {
        name,
        client,
        transport: transportInstance as any,
        transportType: transport,
        tools,
        connectedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        config,
        status: 'connected',
      };

      this.clients.set(name, clientInfo);

      this.log(`✅ Connected to ${name} (${tools.length} tools)`);
      this.printAvailableTools(name, tools);

      return name;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`❌ Failed to connect to ${name}:`, errorMessage);

      if (this.options.autoReconnect) {
        this.scheduleReconnect(name, config);
      }

      throw error;
    }
  }

  /**
   * Disconnect a specific MCP client
   */
  async disconnectClient(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;

    // Clear any pending reconnect
    const timeout = this.reconnectTimeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(name);
    }

    try {
      await client.client.close();
      if ('close' in client.transport && typeof client.transport.close === 'function') {
        await client.transport.close();
      }
    } catch (error) {
      this.log(`Error closing client ${name}:`, error);
    }

    this.clients.delete(name);
    this.log(`Disconnected from ${name}`);
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(name: string, config: MCPClientConfig): void {
    if (this.reconnectTimeouts.has(name)) return;

    const timeout = setTimeout(async () => {
      this.reconnectTimeouts.delete(name);
      this.log(`Attempting to reconnect to ${name}...`);

      try {
        await this.connectClient(config);
      } catch (error) {
        this.log(`Reconnection failed for ${name}`);
      }
    }, this.options.reconnectDelay);

    this.reconnectTimeouts.set(name, timeout);
  }

  /**
   * Call a tool on the appropriate MCP client
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options: { timeout?: number; namespace?: string } = {}
  ): Promise<unknown> {
    const timeout = options.timeout ?? this.options.toolTimeout;

    // Find the client that has this tool
    // If namespace is provided, only look in that client's tools
    let clientInfo: MCPClientInfo | undefined;
    let actualToolName = toolName;

    if (options.namespace) {
      // Look in specific namespace
      clientInfo = this.clients.get(options.namespace);
      if (!clientInfo) {
        throw new Error(`Namespace '${options.namespace}' not found`);
      }
      // Remove namespace prefix if present
      const prefix = `${options.namespace}-`;
      if (actualToolName.startsWith(prefix)) {
        actualToolName = actualToolName.slice(prefix.length);
      }
      if (!clientInfo.tools.some((t) => t.name === actualToolName)) {
        throw new Error(`Tool '${actualToolName}' not found in namespace '${options.namespace}'`);
      }
    } else {
      // Search all clients
      for (const [, info] of this.clients) {
        const tool = info.tools.find((t) => t.name === toolName);
        if (tool) {
          clientInfo = info;
          break;
        }
      }
    }

    if (!clientInfo) {
      throw new Error(`Tool '${toolName}' not found on any connected MCP server`);
    }

    const requestId = `req_${++this.requestId}`;
    clientInfo.lastUsed = new Date().toISOString();

    try {
      this.log(`[${requestId}] Calling '${actualToolName}' on '${clientInfo.name}'`);

      const result = await Promise.race([
        clientInfo.client.request(
          {
            method: 'tools/call',
            params: {
              name: actualToolName,
              arguments: args,
            },
          },
          CallToolResultSchema
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool call timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      this.log(`[${requestId}] Completed successfully`);
      return this.formatToolResult(result);
    } catch (error) {
      this.log(`[${requestId}] Failed:`, error instanceof Error ? error.message : error);

      if (error instanceof McpError) {
        throw new Error(`MCP Error (${toolName}): ${error.message} (code: ${error.code})`);
      }
      throw error;
    }
  }

  /**
   * Format MCP tool result for consistent output
   */
  private formatToolResult(result: { content?: Array<{ type: string; text?: string; [key: string]: unknown }> }): string {
    if (!result || !result.content) {
      return '';
    }

    return result.content
      .map((item) => {
        if (item.type === 'text') {
          return item.text || '';
        } else if (item.type === 'resource') {
          return `[Resource: ${(item as any).resource?.uri || 'unknown'}]`;
        } else if (item.type === 'image') {
          return `[Image: ${item.mimeType || 'unknown'}]`;
        } else if (item.type === 'audio') {
          return `[Audio: ${item.mimeType || 'unknown'}]`;
        } else {
          return JSON.stringify(item);
        }
      })
      .join('\n');
  }

  /**
   * Get all tools from all connected MCP clients
   * Optionally with namespace prefix
   */
  getAllTools(options: { namespacePrefix?: boolean } = {}): MCPToolInfo[] {
    const allTools: MCPToolInfo[] = [];

    for (const [clientName, client] of this.clients) {
      for (const tool of client.tools) {
        if (options.namespacePrefix) {
          // Prefix tool name with client name for namespacing
          allTools.push({
            ...tool,
            name: `${clientName}-${tool.name}`,
          });
        } else {
          allTools.push(tool);
        }
      }
    }

    return allTools;
  }

  /**
   * Get tools from a specific client
   */
  getClientTools(clientName: string): MCPToolInfo[] {
    const client = this.clients.get(clientName);
    return client?.tools || [];
  }

  /**
   * Get list of connected MCP clients
   */
  listClients(): Array<{
    name: string;
    status: string;
    toolCount: number;
    connectedAt: string;
    lastUsed: string;
    transportType: MCPTransportType;
  }> {
    return Array.from(this.clients.entries()).map(([name, info]) => ({
      name,
      status: info.status,
      toolCount: info.tools.length,
      connectedAt: info.connectedAt,
      lastUsed: info.lastUsed,
      transportType: info.transportType,
    }));
  }

  /**
   * Get client info by name
   */
  getClient(name: string): MCPClientInfo | undefined {
    return this.clients.get(name);
  }

  /**
   * Refresh tool lists from all connected clients
   */
  async refreshTools(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        const toolsResult = await client.client.request(
          {
            method: 'tools/list',
            params: {},
          },
          ListToolsResultSchema
        );

        client.tools = toolsResult.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema,
          serverName: name,
        }));

        this.log(`Refreshed ${name}: ${client.tools.length} tools`);
      } catch (error) {
        this.log(`Failed to refresh tools for ${name}:`, error);
        client.status = 'error';
        client.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  /**
   * List resources from a specific client or all clients
   */
  async listResources(clientName?: string): Promise<Array<{ clientName: string; resources: unknown[] }>> {
    const results: Array<{ clientName: string; resources: unknown[] }> = [];
    const clients = clientName ? [clientName] : Array.from(this.clients.keys());

    for (const name of clients) {
      const client = this.clients.get(name);
      if (!client) continue;

      try {
        const result = await client.client.request(
          {
            method: 'resources/list',
            params: {},
          },
          ListResourcesResultSchema
        );

        results.push({
          clientName: name,
          resources: result.resources,
        });
      } catch (error) {
        this.log(`Failed to list resources for ${name}:`, error);
      }
    }

    return results;
  }

  /**
   * Read a resource from a specific client
   */
  async readResource(uri: string, clientName?: string): Promise<unknown> {
    if (clientName) {
      const client = this.clients.get(clientName);
      if (!client) {
        throw new Error(`Client '${clientName}' not found`);
      }

      const result = await client.client.request(
        {
          method: 'resources/read',
          params: { uri },
        },
        ReadResourceResultSchema
      );

      return result;
    } else {
      // Search all clients
      for (const [name, client] of this.clients) {
        try {
          const result = await client.client.request(
            {
              method: 'resources/read',
              params: { uri },
            },
            ReadResourceResultSchema
          );
          return { clientName: name, ...result };
        } catch {
          // Continue to next client
        }
      }
      throw new Error(`Resource '${uri}' not found on any client`);
    }
  }

  /**
   * List prompts from a specific client or all clients
   */
  async listPrompts(clientName?: string): Promise<Array<{ clientName: string; prompts: unknown[] }>> {
    const results: Array<{ clientName: string; prompts: unknown[] }> = [];
    const clients = clientName ? [clientName] : Array.from(this.clients.keys());

    for (const name of clients) {
      const client = this.clients.get(name);
      if (!client) continue;

      try {
        const result = await client.client.request(
          {
            method: 'prompts/list',
            params: {},
          },
          ListPromptsResultSchema
        );

        results.push({
          clientName: name,
          prompts: result.prompts,
        });
      } catch (error) {
        this.log(`Failed to list prompts for ${name}:`, error);
      }
    }

    return results;
  }

  /**
   * Get a prompt from a specific client
   */
  async getPrompt(name: string, args: Record<string, unknown>, clientName?: string): Promise<unknown> {
    if (clientName) {
      const client = this.clients.get(clientName);
      if (!client) {
        throw new Error(`Client '${clientName}' not found`);
      }

      const result = await client.client.request(
        {
          method: 'prompts/get',
          params: { name, arguments: args },
        },
        GetPromptResultSchema
      );

      return result;
    } else {
      // Search all clients
      for (const [cName, client] of this.clients) {
        try {
          const result = await client.client.request(
            {
              method: 'prompts/get',
              params: { name, arguments: args },
            },
            GetPromptResultSchema
          );
          return { clientName: cName, ...result };
        } catch {
          // Continue to next client
        }
      }
      throw new Error(`Prompt '${name}' not found on any client`);
    }
  }

  /**
   * Health check for all connected clients
   */
  async healthCheck(): Promise<Map<string, { status: string; responseTime: number; error?: string }>> {
    const results = new Map<string, { status: string; responseTime: number; error?: string }>();

    for (const [name, client] of this.clients) {
      try {
        const startTime = Date.now();
        await client.client.request(
          {
            method: 'tools/list',
            params: {},
          },
          ListToolsResultSchema
        );

        results.set(name, {
          status: 'healthy',
          responseTime: Date.now() - startTime,
        });
      } catch (error) {
        results.set(name, {
          status: 'unhealthy',
          responseTime: 0,
          error: error instanceof Error ? error.message : String(error),
        });

        if (this.options.autoReconnect) {
          this.scheduleReconnect(name, client.config);
        }
      }
    }

    return results;
  }

  /**
   * Start the automatic refresh timer
   */
  private startRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    if (this.options.refreshInterval > 0) {
      this.refreshTimer = setInterval(async () => {
        try {
          await this.refreshTools();
        } catch (error) {
          this.log('Auto-refresh failed:', error);
        }
      }, this.options.refreshInterval);
    }
  }

  /**
   * Print available tools for a client
   */
  private printAvailableTools(clientName: string, tools: MCPToolInfo[]): void {
    if (tools.length === 0) {
      this.log(`  No tools available from ${clientName}`);
      return;
    }

    this.log(`\n  --- ${clientName} Tools (${tools.length}) ---`);
    for (const tool of tools) {
      this.log(`    • ${tool.name}: ${tool.description.slice(0, 60)}${tool.description.length > 60 ? '...' : ''}`);
    }
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[MCP-Proxy]', ...args);
    }
  }

  /**
   * Get statistics about the MCP proxy hub
   */
  getStats(): {
    totalClients: number;
    totalTools: number;
    clients: Array<{
      name: string;
      toolCount: number;
      status: string;
      transportType: MCPTransportType;
    }>;
  } {
    const clients = Array.from(this.clients.entries()).map(([name, info]) => ({
      name,
      toolCount: info.tools.length,
      status: info.status,
      transportType: info.transportType,
    }));

    return {
      totalClients: this.clients.size,
      totalTools: clients.reduce((sum, c) => sum + c.toolCount, 0),
      clients,
    };
  }
}
