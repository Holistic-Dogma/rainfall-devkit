/**
 * CLI handler types for tool-specific preflight/postflight/display overrides
 */

import type { Rainfall } from '../../sdk.js';

export interface ToolContext {
  rainfall: Rainfall;
  toolId: string;
  params: Record<string, unknown>;
  args: string[];
  flags: {
    raw?: boolean;
    quiet?: boolean;
    [key: string]: unknown;
  };
}

export interface PreflightResult {
  /** Modified params to use for execution */
  params?: Record<string, unknown>;
  /** Skip normal execution and return this result directly */
  skipExecution?: unknown;
  /** Additional context to pass to postflight */
  context?: Record<string, unknown>;
}

export interface PostflightContext extends ToolContext {
  /** The result from tool execution (or skipExecution) */
  result: unknown;
  /** Context passed from preflight */
  preflightContext?: Record<string, unknown>;
}

export interface DisplayContext extends PostflightContext {
  /** Output stream (for testing/custom output) */
  output?: NodeJS.WriteStream;
}

/** Tool handler interface for custom CLI behavior */
export interface ToolHandler {
  /** Tool ID this handler applies to (or pattern) */
  toolId: string | RegExp;
  
  /** 
   * Preflight: Modify params, validate, or skip execution entirely
   * Called before tool execution
   */
  preflight?(context: ToolContext): Promise<PreflightResult | void> | PreflightResult | void;
  
  /**
   * Postflight: Process result, trigger side effects
   * Called after successful tool execution
   */
  postflight?(context: PostflightContext): Promise<void> | void;
  
  /**
   * Display: Custom output formatting
   * Return true if handled, false to use default display
   */
  display?(context: DisplayContext): Promise<boolean> | boolean;
}

/** Registry of tool handlers */
export class ToolHandlerRegistry {
  private handlers: ToolHandler[] = [];
  
  register(handler: ToolHandler): void {
    this.handlers.push(handler);
  }
  
  findHandler(toolId: string): ToolHandler | undefined {
    return this.handlers.find(h => {
      if (typeof h.toolId === 'string') {
        return h.toolId === toolId;
      }
      return h.toolId.test(toolId);
    });
  }
  
  getAllHandlers(): ToolHandler[] {
    return [...this.handlers];
  }
}

// Global registry instance
export const globalHandlerRegistry = new ToolHandlerRegistry();
