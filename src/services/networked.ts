/**
 * Rainfall Networked Executor - Distributed job execution via Rainfall API
 * 
 * This service enables multi-computer networked executions without direct Redis access.
 * All communication goes through the authenticated Rainfall API.
 */

import { Rainfall } from '../sdk.js';

export interface NodeCapabilities {
  /** Can execute local commands/shell */
  localExec?: boolean;
  /** Can watch files for changes */
  fileWatch?: boolean;
  /** Can listen to passive events (webhooks, etc.) */
  passiveListen?: boolean;
  /** Can execute browser automation */
  browser?: boolean;
  /** Custom capability flags */
  custom?: string[];
}

export interface EdgeNodeRegistration {
  edgeNodeId: string;
  hostname: string;
  capabilities: string[];
  wsPort?: number;
  httpPort?: number;
  registeredAt: string;
}

export interface QueuedJob {
  jobId: string;
  toolId: string;
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed';
  executionMode: 'local-only' | 'distributed' | 'any';
  requesterEdgeNodeId?: string;
  executorEdgeNodeId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface NetworkedExecutorOptions {
  /** WebSocket port for receiving push jobs */
  wsPort?: number;
  /** HTTP port for health checks */
  httpPort?: number;
  /** Edge node capabilities */
  capabilities?: NodeCapabilities;
  /** Hostname identifier */
  hostname?: string;
  /** Existing edge node ID to reuse (from config) */
  edgeNodeId?: string;
  /** Callback when a new edge node ID is registered (to save to config) */
  onEdgeNodeRegistered?: (edgeNodeId: string) => void;
}

export interface EdgeNodeMetrics {
  /** Last heartbeat latency in ms */
  heartbeatLatencyMs: number;
  /** Average heartbeat latency over last 10 samples */
  avgHeartbeatLatencyMs: number;
  /** Current queue depth (pending job callbacks) */
  queueDepth: number;
  /** Total jobs claimed since startup */
  totalJobsClaimed: number;
  /** Total jobs completed since startup */
  totalJobsCompleted: number;
  /** Total jobs failed since startup */
  totalJobsFailed: number;
  /** Timestamp of last successful heartbeat */
  lastHeartbeatAt: string | null;
  /** Timestamp of last job claim */
  lastJobClaimedAt: string | null;
}

export class RainfallNetworkedExecutor {
  private rainfall: Rainfall;
  private options: NetworkedExecutorOptions;
  private edgeNodeId?: string;
  private jobCallbacks = new Map<string, (result: unknown, error?: string) => void>();
  private resultPollingInterval?: NodeJS.Timeout;
  private jobClaimInterval?: NodeJS.Timeout;
  private isClaiming = false;
  private jobExecutor?: (toolId: string, params: Record<string, unknown>) => Promise<unknown>;

  // Edge node metrics
  private heartbeatLatencies: number[] = [];
  private totalJobsClaimed = 0;
  private totalJobsCompleted = 0;
  private totalJobsFailed = 0;
  private lastHeartbeatAt: string | null = null;
  private lastJobClaimedAt: string | null = null;

  constructor(rainfall: Rainfall, options: NetworkedExecutorOptions = {}) {
    this.rainfall = rainfall;
    this.options = {
      wsPort: 8765,
      httpPort: 8787,
      hostname: process.env.HOSTNAME || 'local-daemon',
      capabilities: {
        localExec: true,
        fileWatch: true,
        passiveListen: true,
      },
      ...options,
    };
  }

  /**
   * Register this edge node with the Rainfall backend
   * Reuses existing edgeNodeId from config if available and valid
   * The daemon is the single source of truth for edge node identity
   */
  async registerEdgeNode(): Promise<string> {
    const capabilities = this.buildCapabilitiesList();
    
    // If we have an existing edge node ID from config, try to reuse it
    if (this.options.edgeNodeId) {
      try {
        // Send a heartbeat to check if the edge node is still valid
        const heartbeatResult = await this.rainfall.executeTool<{ success: boolean; status: string }>('edge-node-heartbeat', {
          edgeNodeId: this.options.edgeNodeId,
          activeJobs: 0,
          queueDepth: 0,
        });
        
        if (heartbeatResult.success && heartbeatResult.status === 'active') {
          this.edgeNodeId = this.options.edgeNodeId;
          console.log(`🌐 Edge node reconnected to Rainfall as ${this.edgeNodeId}`);
          this.startHeartbeat();
          return this.edgeNodeId;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('expired') || message.includes('not found')) {
          console.log(`⚠️  Existing edge node ${this.options.edgeNodeId} expired, registering new one...`);
        } else {
          console.log(`⚠️  Could not reuse existing edge node: ${message}`);
        }
        // Continue to register a new edge node
      }
    }
    
    try {
      // Register a new edge node with the backend
      const result = await this.rainfall.executeTool<{ edgeNodeId: string }>('register-edge-node', {
        hostname: this.options.hostname,
        capabilities,
        wsPort: this.options.wsPort,
        httpPort: this.options.httpPort,
        version: '0.1.0',
      });

      this.edgeNodeId = result.edgeNodeId;
      console.log(`🌐 Edge node registered with Rainfall as ${this.edgeNodeId}`);
      
      // Notify callback to save to config
      if (this.options.onEdgeNodeRegistered) {
        this.options.onEdgeNodeRegistered(this.edgeNodeId);
      }
      
      // Start heartbeat to keep registration alive
      this.startHeartbeat();
      
      return this.edgeNodeId;
    } catch (error) {
      // If backend registration fails, throw an error - don't fall back to local mode
      // This ensures we never have ID mismatches
      throw new Error(`Failed to register edge node with backend: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private heartbeatInterval?: NodeJS.Timeout;

  /**
   * Start sending periodic heartbeats to keep edge node registration alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Send heartbeat every 20 seconds (TTL is 2 minutes, aggressive polling for faster failure detection)
    this.heartbeatInterval = setInterval(async () => {
      if (!this.edgeNodeId) return;
      
      const startTime = Date.now();
      try {
        await this.rainfall.executeTool('edge-node-heartbeat', {
          edgeNodeId: this.edgeNodeId,
          activeJobs: this.jobCallbacks.size,
          queueDepth: this.jobCallbacks.size,
          metrics: this.getMetrics(),
        });

        // Track heartbeat latency
        const latency = Date.now() - startTime;
        this.heartbeatLatencies.push(latency);
        if (this.heartbeatLatencies.length > 10) {
          this.heartbeatLatencies.shift();
        }
        this.lastHeartbeatAt = new Date().toISOString();
      } catch (error) {
        // Heartbeat failed - edge node may have expired
        console.warn(`⚠️  Edge node heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 20000);
  }

  /**
   * Stop sending heartbeats
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Unregister this edge node on shutdown
   */
  async unregisterEdgeNode(): Promise<void> {
    if (!this.edgeNodeId) return;

    // Stop heartbeat first
    this.stopHeartbeat();

    try {
      await this.rainfall.executeTool('unregister-edge-node', {
        edgeNodeId: this.edgeNodeId,
      });
      console.log(`🌐 Edge node ${this.edgeNodeId} unregistered`);
    } catch {
      // Silent fail - edge node may not exist on backend
    }

    if (this.resultPollingInterval) {
      clearInterval(this.resultPollingInterval);
    }
  }

  /**
   * Queue a tool execution for distributed processing
   * Non-blocking - returns immediately with a job ID
   */
  async queueToolExecution(
    toolId: string, 
    params: Record<string, unknown>,
    options: { 
      executionMode?: 'local-only' | 'distributed' | 'any';
      callback?: (result: unknown, error?: string) => void;
    } = {}
  ): Promise<string> {
    const executionMode = options.executionMode || 'any';

    try {
      // Try to use the queue-job tool on the backend
      const result = await this.rainfall.executeTool<{ jobId: string }>('queue-job', {
        toolId,
        params,
        executionMode,
        requesterEdgeNodeId: this.edgeNodeId,
      });

      // Store callback if provided
      if (options.callback) {
        this.jobCallbacks.set(result.jobId, options.callback);
        this.startResultPolling();
      }

      return result.jobId;
    } catch (error) {
      // Fallback: execute synchronously if queue-job isn't available
      if (executionMode === 'local-only' || executionMode === 'any') {
        try {
          const result = await this.rainfall.executeTool(toolId, params);
          if (options.callback) {
            options.callback(result);
          }
          return `local-${Date.now()}`;
        } catch (execError) {
          if (options.callback) {
            options.callback(null, String(execError));
          }
          throw execError;
        }
      }
      throw error;
    }
  }

  /**
   * Get status of a queued job
   */
  async getJobStatus(jobId: string): Promise<QueuedJob | null> {
    try {
      const result = await this.rainfall.executeTool<{ job: QueuedJob }>('get-job-status', {
        jobId,
      });
      return result.job;
    } catch {
      return null;
    }
  }

  /**
   * Subscribe to job results via polling (WebSocket fallback)
   * In the future, this will use WebSocket push from ApresMoi
   */
  async subscribeToResults(callback: (jobId: string, result: unknown, error?: string) => void): Promise<void> {
    // For v0.1, we poll for results
    // Future: ApresMoi pushes results back over the daemon WebSocket
    console.log('📡 Subscribed to job results via Rainfall (polling mode)');

    // Store global callback for polled results
    this.onResultReceived = callback;
  }

  private onResultReceived?: (jobId: string, result: unknown, error?: string) => void;

  /**
   * Start polling for job results (fallback until WebSocket push is ready)
   */
  private startResultPolling(): void {
    if (this.resultPollingInterval) return;

    this.resultPollingInterval = setInterval(async () => {
      for (const [jobId, callback] of this.jobCallbacks) {
        try {
          const job = await this.getJobStatus(jobId);
          if (job?.status === 'completed' || job?.status === 'failed') {
            callback(job.result, job.error);
            this.jobCallbacks.delete(jobId);
            
            if (this.onResultReceived) {
              this.onResultReceived(jobId, job.result, job.error);
            }
          }
        } catch {
          // Ignore polling errors
        }
      }

      // Stop polling if no more callbacks
      if (this.jobCallbacks.size === 0 && this.resultPollingInterval) {
        clearInterval(this.resultPollingInterval);
        this.resultPollingInterval = undefined;
      }
    }, 2000);
  }

  /**
   * Claim a job for execution on this edge node
   */
  async claimJob(): Promise<QueuedJob | null> {
    try {
      const result = await this.rainfall.executeTool<{ job: QueuedJob }>('claim-job', {
        edgeNodeId: this.edgeNodeId,
        capabilities: this.buildCapabilitiesList(),
        maxWait: 5000,
      });
      if (result.job) {
        console.log(`📥 Claimed job ${result.job.jobId} for tool ${result.job.toolId}`);
      }
      return result.job;
    } catch (error) {
      console.warn(`⚠️ Failed to claim job: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Start polling for jobs to execute
   * @param executor - Function to execute the tool and return the result
   */
  startJobPolling(executor: (toolId: string, params: Record<string, unknown>) => Promise<unknown>): void {
    if (this.jobClaimInterval) return; // Already polling
    
    this.jobExecutor = executor;
    console.log('🔄 Started polling for edge jobs');
    
    this.jobClaimInterval = setInterval(async () => {
      if (this.isClaiming) return; // Prevent concurrent claims
      this.isClaiming = true;
      
      try {
        const job = await this.claimJob();
        
        if (job) {
          this.totalJobsClaimed++;
          this.lastJobClaimedAt = new Date().toISOString();
          console.log(`📥 Claimed job ${job.jobId} for tool ${job.toolId}`);
          
          try {
            // Execute the job
            const result = await executor(job.toolId, job.params);
            
            // Submit the result
            await this.submitJobResult(job.jobId, result);
            this.totalJobsCompleted++;
            console.log(`✅ Completed job ${job.jobId}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.submitJobResult(job.jobId, null, errorMessage);
            this.totalJobsFailed++;
            console.log(`❌ Failed job ${job.jobId}: ${errorMessage}`);
          }
        }
      } catch (error) {
        // Silent fail - will retry on next interval
      } finally {
        this.isClaiming = false;
      }
    }, 3000); // Poll every 3 seconds
  }

  /**
   * Stop polling for jobs
   */
  stopJobPolling(): void {
    if (this.jobClaimInterval) {
      clearInterval(this.jobClaimInterval);
      this.jobClaimInterval = undefined;
      console.log('🛑 Stopped polling for edge jobs');
    }
  }

  /**
   * Submit job result after execution
   */
  async submitJobResult(jobId: string, result: unknown, error?: string): Promise<void> {
    try {
      await this.rainfall.executeTool('submit-job-result', {
        jobId,
        edgeNodeId: this.edgeNodeId,
        result,
        error,
      });
    } catch {
      // Silent fail - result may not be needed
    }
  }

  /**
   * Register additional proc nodes for this edge node
   */
  async registerProcNodes(procNodeIds: string[]): Promise<void> {
    if (!this.edgeNodeId) {
      throw new Error('Edge node not registered');
    }

    try {
      const result = await this.rainfall.executeTool<{
        success: boolean;
        edgeNodeId: string;
        edgeNodeSecret?: string;
        registeredProcNodes: string[];
      }>('register-proc-edge-nodes', {
        edgeNodeId: this.edgeNodeId,
        procNodeIds,
        hostname: this.options.hostname,
      });

      if (!result.success) {
        throw new Error('Backend returned unsuccessful registration');
      }

      console.log(`🌐 Registered proc nodes: ${procNodeIds.join(', ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to register proc nodes: ${message}`);
    }
  }

  /**
   * Get this edge node's ID
   */
  getEdgeNodeId(): string | undefined {
    return this.edgeNodeId;
  }

  /**
   * Get edge node metrics for observability
   */
  getMetrics(): EdgeNodeMetrics {
    const avgLatency = this.heartbeatLatencies.length > 0
      ? this.heartbeatLatencies.reduce((a, b) => a + b, 0) / this.heartbeatLatencies.length
      : 0;

    return {
      heartbeatLatencyMs: this.heartbeatLatencies[this.heartbeatLatencies.length - 1] || 0,
      avgHeartbeatLatencyMs: Math.round(avgLatency),
      queueDepth: this.jobCallbacks.size,
      totalJobsClaimed: this.totalJobsClaimed,
      totalJobsCompleted: this.totalJobsCompleted,
      totalJobsFailed: this.totalJobsFailed,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastJobClaimedAt: this.lastJobClaimedAt,
    };
  }

  /**
   * Build capabilities list from options
   */
  private buildCapabilitiesList(): string[] {
    const caps = this.options.capabilities || {};
    const list: string[] = [];

    if (caps.localExec) list.push('local-exec');
    if (caps.fileWatch) list.push('file-watch');
    if (caps.passiveListen) list.push('passive-listen');
    if (caps.browser) list.push('browser');
    if (caps.custom) list.push(...caps.custom);

    return list;
  }
}
