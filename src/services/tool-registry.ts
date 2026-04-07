/**
 * Unified Tool Registry
 * 
 * Loads and manages tools from multiple sources:
 * - Registry (backend olympic.registries table)
 * - Rainfall nodes (via SDK)
 * - MCP servers (via MCPProxyHub)
 */

import { Rainfall } from '../sdk.js';
import { MCPProxyHub } from './mcp-proxy.js';
import { RegisteredTool, ToolSourceType } from '../types.js';

export interface ToolRegistryOptions {
  rainfall: Rainfall;
  mcpProxy?: MCPProxyHub;
  refreshIntervalMs?: number;
  debug?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private rainfall: Rainfall;
  private mcpProxy?: MCPProxyHub;
  private refreshInterval?: NodeJS.Timeout;
  private debug: boolean;

  constructor(options: ToolRegistryOptions) {
    this.rainfall = options.rainfall;
    this.mcpProxy = options.mcpProxy;
    this.debug = options.debug ?? false;
    if (options.refreshIntervalMs) {
      this.startRefreshTimer(options.refreshIntervalMs);
    }
  }

  /**
   * Refresh the tool registry from all sources
   */
  async refresh(): Promise<void> {
    this.log('Refreshing tool registry...');
    const newTools = new Map<string, RegisteredTool>();

    // 1. Load from backend registry (new!)
    try {
      const registryTools = await this.loadRegistryTools();
      for (const tool of registryTools) {
        newTools.set(tool.id, tool);
      }
      this.log(`Loaded ${registryTools.length} registry tools`);
    } catch (error) {
      this.log('Failed to load registry tools:', error);
    }

    // 2. Load Rainfall tools (existing behavior)
    try {
      const rainfallTools = await this.loadRainfallTools();
      for (const tool of rainfallTools) {
        // Registry takes precedence if same ID
        if (!newTools.has(tool.id)) {
          newTools.set(tool.id, tool);
        }
      }
      this.log(`Loaded ${rainfallTools.length} Rainfall tools`);
    } catch (error) {
      this.log('Failed to load Rainfall tools:', error);
    }

    // 3. Load MCP tools (existing behavior)
    if (this.mcpProxy) {
      try {
        const mcpTools = this.loadMCPTools();
        for (const tool of mcpTools) {
          if (!newTools.has(tool.id)) {
            newTools.set(tool.id, tool);
          }
        }
        this.log(`Loaded ${mcpTools.length} MCP tools`);
      } catch (error) {
        this.log('Failed to load MCP tools:', error);
      }
    }

    this.tools = newTools;
  }

  /**
   * Get tools matching the specified criteria
   */
  getTools(options: {
    sources?: ToolSourceType[];
    specificIds?: string[];
    maxTools?: number;
    includeHidden?: boolean;
  } = {}): RegisteredTool[] {
    let tools = Array.from(this.tools.values());

    // Filter by specific IDs
    if (options.specificIds) {
      tools = tools.filter(t => options.specificIds!.includes(t.id));
    }

    // Filter by source type
    if (options.sources) {
      tools = tools.filter(t => options.sources!.includes(t.source.type));
    }

    // Sort by priority: local > mcp > external > rainfall (latency-based)
    tools.sort((a, b) => {
      const priority = { local: 0, mcp: 1, external: 2, rainfall: 3 };
      return priority[a.source.type] - priority[b.source.type];
    });

    // Limit
    if (options.maxTools) {
      tools = tools.slice(0, options.maxTools);
    }

    return tools;
  }

  /**
   * Get a single tool by ID
   */
  getTool(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  /**
   * Get all available tool sources
   */
  getSources(): ToolSourceType[] {
    const sources = new Set<ToolSourceType>();
    for (const tool of this.tools.values()) {
      sources.add(tool.source.type);
    }
    return Array.from(sources);
  }

  /**
   * Stop the refresh timer
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private async loadRegistryTools(): Promise<RegisteredTool[]> {
    const result = await this.rainfall.getRegistryTools();
    if (!result.success || !Array.isArray(result.tools)) {
      return [];
    }

    return result.tools.map((t: unknown) => {
      const tool = t as Record<string, unknown>;
      return {
        id: tool.id as string,
        name: tool.name as string,
        description: tool.description as string,
        parameters: (tool.parameters as Record<string, unknown>) || { type: 'object', properties: {} },
        source: (tool.source as { type: ToolSourceType; metadata: Record<string, unknown> }) || { type: 'external', metadata: {} },
      };
    });
  }

  private async loadRainfallTools(): Promise<RegisteredTool[]> {
    const descriptions = await this.rainfall.listTools();
    const tools: RegisteredTool[] = [];

    for (const desc of descriptions) {
      try {
        const schema = await this.rainfall.getToolSchema(desc.id);
        tools.push({
          id: desc.id,
          name: desc.name || desc.id,
          description: desc.description || schema.description || '',
          parameters: (schema.parameters as Record<string, unknown>) || { type: 'object', properties: {} },
          source: {
            type: 'rainfall',
            metadata: { nodeId: desc.id, category: desc.category || 'general' },
          },
        });
      } catch (error) {
        this.log(`Failed to load schema for ${desc.id}:`, error);
      }
    }

    return tools;
  }

  private loadMCPTools(): RegisteredTool[] {
    if (!this.mcpProxy) {
      return [];
    }

    const mcpTools = this.mcpProxy.getAllTools({ namespacePrefix: true });

    return mcpTools.map(mcpTool => ({
      id: `${mcpTool.serverName}-${mcpTool.name}`,
      name: mcpTool.name,
      description: `[${mcpTool.serverName}] ${mcpTool.description}`,
      parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
      source: {
        type: 'mcp',
        metadata: { serverName: mcpTool.serverName, originalName: mcpTool.name },
      },
    }));
  }

  private startRefreshTimer(intervalMs: number): void {
    this.refreshInterval = setInterval(() => {
      this.refresh().catch(err => this.log('Refresh failed:', err));
    }, intervalMs);
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[ToolRegistry]', ...args);
    }
  }
}
