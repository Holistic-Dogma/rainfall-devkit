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
}

export class RainfallNetworkedExecutor {
  private rainfall: Rainfall;
  private options: NetworkedExecutorOptions;
  private edgeNodeId?: string;
  private jobCallbacks = new Map<string, (result: unknown, error?: string) => void>();
  private resultPollingInterval?: NodeJS.Timeout;

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
   */
  async registerEdgeNode(): Promise<string> {
    const capabilities = this.buildCapabilitiesList();
    
    try {
      // Use the register-edge-node tool if available, otherwise fallback to direct API
      const result = await this.rainfall.executeTool<{ edgeNodeId: string }>('register-edge-node', {
        hostname: this.options.hostname,
        capabilities,
        wsPort: this.options.wsPort,
        httpPort: this.options.httpPort,
        version: '0.1.0',
      });

      this.edgeNodeId = result.edgeNodeId;
      console.log(`🌐 Edge node registered with Rainfall as ${this.edgeNodeId}`);
      return this.edgeNodeId;
    } catch (error) {
      // Fallback: generate a local edge node ID if the backend doesn't have register-edge-node yet
      this.edgeNodeId = `edge-${this.options.hostname}-${Date.now()}`;
      console.log(`🌐 Edge node running in local mode (ID: ${this.edgeNodeId})`);
      return this.edgeNodeId;
    }
  }

  /**
   * Unregister this edge node on shutdown
   */
  async unregisterEdgeNode(): Promise<void> {
    if (!this.edgeNodeId) return;

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
      });
      return result.job;
    } catch {
      return null;
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
   * Get this edge node's ID
   */
  getEdgeNodeId(): string | undefined {
    return this.edgeNodeId;
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
