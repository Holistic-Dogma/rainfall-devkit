/**
 * Rainfall Daemon Context - Persistent memory and session state
 * 
 * Provides:
 * - Persistent memory storage (local + cloud sync)
 * - Session context for ongoing conversations/workflows
 * - Tool execution history
 * - Local state management
 */

import { Rainfall } from '../sdk.js';

export interface MemoryEntry {
  id: string;
  content: string;
  keywords: string[];
  timestamp: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionContext {
  id: string;
  startedAt: string;
  lastActivity: string;
  variables: Record<string, unknown>;
  messageHistory: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string;
  }>;
}

export interface ToolExecutionRecord {
  id: string;
  toolId: string;
  params: Record<string, unknown>;
  result: unknown;
  error?: string;
  timestamp: string;
  duration: number;
  edgeNodeId?: string;
}

export interface ContextOptions {
  /** Maximum number of memories to cache locally */
  maxLocalMemories?: number;
  /** Maximum message history per session */
  maxMessageHistory?: number;
  /** Maximum execution history to keep */
  maxExecutionHistory?: number;
  /** Session TTL in milliseconds */
  sessionTtl?: number;
}

export class RainfallDaemonContext {
  private rainfall: Rainfall;
  private options: Required<ContextOptions>;
  private localMemories: Map<string, MemoryEntry> = new Map();
  private sessions: Map<string, SessionContext> = new Map();
  private executionHistory: ToolExecutionRecord[] = [];
  private currentSessionId?: string;

  constructor(rainfall: Rainfall, options: ContextOptions = {}) {
    this.rainfall = rainfall;
    this.options = {
      maxLocalMemories: 1000,
      maxMessageHistory: 100,
      maxExecutionHistory: 500,
      sessionTtl: 24 * 60 * 60 * 1000, // 24 hours
      ...options,
    };
  }

  /**
   * Initialize the context - load recent memories from cloud
   */
  async initialize(): Promise<void> {
    try {
      // Try to sync recent memories from cloud
      const recentMemories = await this.rainfall.memory.recall({
        queries: ['daemon:context'],
        limit: this.options.maxLocalMemories,
      }) as Array<{ id: string; content: string; keywords?: string[]; timestamp: string; source?: string; metadata?: Record<string, unknown> }>;

      for (const memory of recentMemories) {
        this.localMemories.set(memory.id, {
          id: memory.id,
          content: memory.content,
          keywords: memory.keywords || [],
          timestamp: memory.timestamp,
          source: memory.source,
          metadata: memory.metadata,
        });
      }

      console.log(`🧠 Loaded ${this.localMemories.size} memories into context`);
    } catch (error) {
      console.warn('⚠️  Could not sync memories:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Create or get a session
   */
  getSession(sessionId?: string): SessionContext {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastActivity = new Date().toISOString();
      return session;
    }

    // Create new session
    const newSession: SessionContext = {
      id: sessionId || `session-${Date.now()}`,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      variables: {},
      messageHistory: [],
    };

    this.sessions.set(newSession.id, newSession);
    this.currentSessionId = newSession.id;
    return newSession;
  }

  /**
   * Get the current active session
   */
  getCurrentSession(): SessionContext | undefined {
    if (this.currentSessionId) {
      return this.sessions.get(this.currentSessionId);
    }
    return undefined;
  }

  /**
   * Set the current active session
   */
  setCurrentSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.currentSessionId = sessionId;
    }
  }

  /**
   * Add a message to the current session history
   */
  addMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
    const session = this.getCurrentSession();
    if (!session) return;

    session.messageHistory.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // Trim history if too long
    if (session.messageHistory.length > this.options.maxMessageHistory) {
      session.messageHistory = session.messageHistory.slice(-this.options.maxMessageHistory);
    }
  }

  /**
   * Store a memory (local + cloud sync)
   */
  async storeMemory(
    content: string, 
    options: { 
      keywords?: string[];
      source?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const entry: MemoryEntry = {
      id,
      content,
      keywords: options.keywords || [],
      timestamp: new Date().toISOString(),
      source: options.source || 'daemon',
      metadata: options.metadata,
    };

    // Store locally
    this.localMemories.set(id, entry);

    // Sync to cloud
    try {
      await this.rainfall.memory.create({
        content,
        keywords: [...(options.keywords || []), 'daemon:context'],
        metadata: {
          ...options.metadata,
          daemonMemoryId: id,
          source: options.source || 'daemon',
        },
      });
    } catch (error) {
      console.warn('⚠️  Could not sync memory to cloud:', error instanceof Error ? error.message : error);
    }

    // Trim local cache if needed
    this.trimLocalMemories();

    return id;
  }

  /**
   * Recall memories by query
   */
  async recallMemories(query: string, topK = 5): Promise<MemoryEntry[]> {
    // First check local cache
    const localResults = Array.from(this.localMemories.values())
      .filter(m => 
        m.content.toLowerCase().includes(query.toLowerCase()) ||
        m.keywords.some(k => k.toLowerCase().includes(query.toLowerCase()))
      )
      .slice(0, topK);

    // Also query cloud for more results
    try {
      const cloudResults = await this.rainfall.memory.recall({ queries: [query], limit: topK }) as Array<{ id: string; content: string; keywords?: string[]; timestamp: string; source?: string; metadata?: Record<string, unknown> }>;
      
      // Merge results, preferring local
      const seen = new Set(localResults.map(r => r.id));
      for (const mem of cloudResults) {
        if (!seen.has(mem.id)) {
          localResults.push({
            id: mem.id,
            content: mem.content,
            keywords: mem.keywords || [],
            timestamp: mem.timestamp,
            source: mem.source,
            metadata: mem.metadata,
          });
        }
      }
    } catch {
      // Fall back to local only
    }

    return localResults.slice(0, topK);
  }

  /**
   * Set a session variable
   */
  setVariable(key: string, value: unknown): void {
    const session = this.getCurrentSession();
    if (session) {
      session.variables[key] = value;
    }
  }

  /**
   * Get a session variable
   */
  getVariable<T = unknown>(key: string): T | undefined {
    const session = this.getCurrentSession();
    return session?.variables[key] as T | undefined;
  }

  /**
   * Record a tool execution
   */
  recordExecution(
    toolId: string,
    params: Record<string, unknown>,
    result: unknown,
    options: { error?: string; duration: number; edgeNodeId?: string } = { duration: 0 }
  ): void {
    const record: ToolExecutionRecord = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      toolId,
      params,
      result,
      error: options.error,
      timestamp: new Date().toISOString(),
      duration: options.duration,
      edgeNodeId: options.edgeNodeId,
    };

    this.executionHistory.push(record);

    // Trim history if needed
    if (this.executionHistory.length > this.options.maxExecutionHistory) {
      this.executionHistory = this.executionHistory.slice(-this.options.maxExecutionHistory);
    }
  }

  /**
   * Get recent execution history
   */
  getExecutionHistory(limit = 10): ToolExecutionRecord[] {
    return this.executionHistory.slice(-limit).reverse();
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
    byTool: Record<string, number>;
  } {
    const stats = {
      total: this.executionHistory.length,
      successful: 0,
      failed: 0,
      averageDuration: 0,
      byTool: {} as Record<string, number>,
    };

    let totalDuration = 0;
    for (const exec of this.executionHistory) {
      if (exec.error) {
        stats.failed++;
      } else {
        stats.successful++;
      }
      totalDuration += exec.duration;
      stats.byTool[exec.toolId] = (stats.byTool[exec.toolId] || 0) + 1;
    }

    stats.averageDuration = stats.total > 0 ? totalDuration / stats.total : 0;
    return stats;
  }

  /**
   * Clear old sessions based on TTL
   */
  cleanupSessions(): void {
    const now = Date.now();
    const ttl = this.options.sessionTtl;

    for (const [id, session] of this.sessions) {
      const lastActivity = new Date(session.lastActivity).getTime();
      if (now - lastActivity > ttl) {
        this.sessions.delete(id);
        if (this.currentSessionId === id) {
          this.currentSessionId = undefined;
        }
      }
    }
  }

  /**
   * Get context summary for debugging
   */
  getStatus(): {
    memoriesCached: number;
    activeSessions: number;
    currentSession?: string;
    executionHistorySize: number;
  } {
    return {
      memoriesCached: this.localMemories.size,
      activeSessions: this.sessions.size,
      currentSession: this.currentSessionId,
      executionHistorySize: this.executionHistory.length,
    };
  }

  private trimLocalMemories(): void {
    if (this.localMemories.size <= this.options.maxLocalMemories) return;

    // Sort by timestamp and remove oldest
    const entries = Array.from(this.localMemories.entries())
      .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime());

    const toRemove = entries.slice(0, entries.length - this.options.maxLocalMemories);
    for (const [id] of toRemove) {
      this.localMemories.delete(id);
    }
  }
}
