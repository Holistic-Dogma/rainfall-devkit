/**
 * MCP (Model Context Protocol) server export for Rainfall SDK
 * 
 * This module provides an MCP server that exposes Rainfall tools
 * to AI agents and assistants like Claude, Cursor, etc.
 * 
 * @example
 * ```typescript
 * import { createRainfallMCPServer } from '@rainfall/sdk/mcp';
 * 
 * const server = createRainfallMCPServer({
 *   apiKey: process.env.RAINFALL_API_KEY!
 * });
 * 
 * // Start the server
 * await server.start();
 * ```
 */

import { Rainfall } from './sdk.js';
import { RainfallConfig } from './types.js';

export interface MCPServerConfig extends RainfallConfig {
  /** Server name */
  name?: string;
  /** Server version */
  version?: string;
  /** Tools to expose (defaults to all) */
  tools?: string[];
  /** Tools to exclude */
  excludeTools?: string[];
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Create an MCP server for Rainfall
 */
export function createRainfallMCPServer(config: MCPServerConfig) {
  const rainfall = new Rainfall(config);
  const serverName = config.name || 'rainfall-mcp-server';
  const serverVersion = config.version || '0.1.0';

  let toolCache: MCPTool[] | null = null;

  async function getTools(): Promise<MCPTool[]> {
    if (toolCache) return toolCache;

    const tools = await rainfall.listTools();
    
    let filteredTools = tools;
    
    // Filter by included tools
    if (config.tools) {
      const toolSet = new Set(config.tools);
      filteredTools = filteredTools.filter(t => toolSet.has(t.id));
    }
    
    // Filter out excluded tools
    if (config.excludeTools) {
      const excludeSet = new Set(config.excludeTools);
      filteredTools = filteredTools.filter(t => !excludeSet.has(t.id));
    }

    toolCache = filteredTools.map(t => ({
      name: t.id,
      description: t.description,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    }));

    return toolCache;
  }

  async function handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params = {} } = request;

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: serverName,
                version: serverVersion,
              },
            },
          };

        case 'tools/list':
          const tools = await getTools();
          return {
            jsonrpc: '2.0',
            id,
            result: { tools },
          };

        case 'tools/call':
          const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
          
          if (!name) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Missing tool name',
              },
            };
          }

          const result = await rainfall.executeTool(name, args);
          
          // Format result as MCP content
          const content = typeof result === 'string' 
            ? [{ type: 'text', text: result }]
            : [{ type: 'text', text: JSON.stringify(result, null, 2) }];

          return {
            jsonrpc: '2.0',
            id,
            result: { content },
          };

        case 'resources/list':
          // No resources exposed currently
          return {
            jsonrpc: '2.0',
            id,
            result: { resources: [] },
          };

        case 'prompts/list':
          // No prompts exposed currently
          return {
            jsonrpc: '2.0',
            id,
            result: { prompts: [] },
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message,
          data: error instanceof Error ? { stack: error.stack } : undefined,
        },
      };
    }
  }

  /**
   * Start the MCP server with stdio transport
   */
  async function start(): Promise<void> {
    // Read from stdin and write to stdout
    const { stdin, stdout } = process;

    stdin.setEncoding('utf8');

    let buffer = '';

    stdin.on('data', async (chunk: string) => {
      buffer += chunk;

      // Process complete lines
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          try {
            const request = JSON.parse(line) as MCPRequest;
            const response = await handleRequest(request);
            stdout.write(JSON.stringify(response) + '\n');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorResponse: MCPResponse = {
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32700,
                message: `Parse error: ${message}`,
              },
            };
            stdout.write(JSON.stringify(errorResponse) + '\n');
          }
        }
      }
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.exit(0);
    });
  }

  return {
    handleRequest,
    start,
    getTools,
    rainfall,
  };
}

// Export for direct use
export { Rainfall } from './sdk.js';
export * from './types.js';
export * from './errors.js';
