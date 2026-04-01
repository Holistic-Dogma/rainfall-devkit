/**
 * Task Poller Service
 * 
 * Polls the Rainfall backend for pending tasks and executes them.
 * Supports scheduled tasks (cron) and one-off tasks.
 */

import { Rainfall } from '../sdk.js';

export interface Task {
  id: string;
  subscriber_id: string;
  task_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  schedule?: string;
  prompt?: string;
  agent_config?: Record<string, unknown>;
  task_config?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  visibility: 'private' | 'unlisted' | 'listed';
  namespace?: string;
  target_subscriber_id?: string;
  target_function?: string;
  bundle_hash?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface TaskPollerConfig {
  /** Poll interval in milliseconds (default: 5000) */
  pollInterval?: number;
  /** Maximum concurrent tasks (default: 3) */
  maxConcurrent?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface TaskExecutionContext {
  rainfall: Rainfall;
  task: Task;
  log: (message: string, ...args: unknown[]) => void;
}

export type TaskExecutor = (context: TaskExecutionContext) => Promise<Record<string, unknown>>;

export class TaskPoller {
  private rainfall: Rainfall;
  private config: Required<TaskPollerConfig>;
  private isRunning = false;
  private pollTimer?: NodeJS.Timeout;
  private activeTasks = new Map<string, Promise<void>>();
  private localFunctions: Map<string, { execute: TaskExecutor }>;
  private subscriberId?: string;

  constructor(
    rainfall: Rainfall,
    localFunctions: Map<string, { execute: TaskExecutor }>,
    config: TaskPollerConfig = {}
  ) {
    this.rainfall = rainfall;
    this.localFunctions = localFunctions;
    this.config = {
      pollInterval: config.pollInterval || 5000,
      maxConcurrent: config.maxConcurrent || 3,
      debug: config.debug || false,
    };
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[TaskPoller] ${message}`, ...args);
    }
  }

  /**
   * Initialize the poller and get subscriber info
   */
  async initialize(): Promise<void> {
    try {
      const me = await this.rainfall.getMe();
      this.subscriberId = me.id;
      this.log(`Initialized for subscriber: ${this.subscriberId}`);
    } catch (error) {
      throw new Error(`Failed to initialize task poller: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start polling for tasks
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    if (!this.subscriberId) {
      throw new Error('Task poller not initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.log('Started polling for tasks');

    // Start polling loop
    this.poll();
  }

  /**
   * Stop polling for tasks
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.log('Stopped polling for tasks');
  }

  /**
   * Get current status
   */
  getStatus(): { isRunning: boolean; activeTasks: number; maxConcurrent: number } {
    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks.size,
      maxConcurrent: this.config.maxConcurrent,
    };
  }

  /**
   * Poll for pending tasks
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Check if we have capacity for more tasks
      if (this.activeTasks.size >= this.config.maxConcurrent) {
        this.log(`At max concurrency (${this.config.maxConcurrent}), skipping poll`);
        this.scheduleNextPoll();
        return;
      }

      // Fetch pending tasks
      const response = await this.rainfall.getClient().request<{
        success: boolean;
        items?: Task[];
        error?: string;
      }>(`/olympic/subscribers/${this.subscriberId}/tasks?status=pending&per_page=${this.config.maxConcurrent}`, {
        method: 'GET',
      });

      if (!response.success || !response.items) {
        this.log('Failed to fetch tasks:', response.error);
        this.scheduleNextPoll();
        return;
      }

      let tasks = response.items;

      // Filter to tasks meant for this subscriber
      tasks = tasks.filter(t =>
        !t.target_subscriber_id || t.target_subscriber_id === this.subscriberId
      );

      if (tasks.length > 0) {
        this.log(`Found ${tasks.length} pending task(s) for this subscriber`);

        // Execute tasks up to maxConcurrent
        for (const task of tasks) {
          if (this.activeTasks.size >= this.config.maxConcurrent) {
            break;
          }

          // Skip if already being processed
          if (this.activeTasks.has(task.id)) {
            continue;
          }

          // Check if this is a scheduled task that should run now
          if (task.schedule && !this.shouldRunScheduledTask(task.schedule)) {
            continue;
          }

          // Execute the task
          const executionPromise = this.executeTask(task);
          this.activeTasks.set(task.id, executionPromise);

          // Clean up when done
          executionPromise.finally(() => {
            this.activeTasks.delete(task.id);
          });
        }
      }
    } catch (error) {
      this.log('Error polling for tasks:', error);
    }

    this.scheduleNextPoll();
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.poll();
    }, this.config.pollInterval);
  }

  /**
   * Check if a scheduled task should run now
   * For now, supports simple cron-like expressions and ISO timestamps
   */
  private shouldRunScheduledTask(schedule: string): boolean {
    // If it's an ISO timestamp, check if it's in the past
    if (schedule.includes('T') || schedule.includes('-')) {
      const scheduledTime = new Date(schedule);
      return scheduledTime <= new Date();
    }

    // For cron expressions, we'd need a cron parser
    // For now, assume it should run
    return true;
  }

  /**
   * Execute a task
   */
  private async executeTask(task: Task): Promise<void> {
    this.log(`Executing task: ${task.task_name} (${task.id})`);

    const startTime = Date.now();

    try {
      // Mark task as running
      await this.updateTaskStatus(task.id, 'running');

      // Determine which function to execute: target_function takes precedence
      const functionName = task.target_function || task.task_name;

      // Find the local function to execute
      let localFn = this.localFunctions.get(functionName);

      // If target_function wasn't found, fall back to task_name for backward compatibility
      if (!localFn && task.target_function && task.target_function !== task.task_name) {
        localFn = this.localFunctions.get(task.task_name);
        if (localFn) {
          this.log(`Target function ${task.target_function} not found, falling back to ${task.task_name}`);
        }
      }

      let result: Record<string, unknown>;

      if (localFn) {
        // Execute the local function with sandboxed context
        const context: TaskExecutionContext = {
          rainfall: this.rainfall,
          task,
          log: (message, ...args) => this.log(`[${functionName}] ${message}`, ...args),
        };

        // Apply permissions sandbox if specified
        if (task.permissions?.paths) {
          this.log(`Applying path permissions:`, task.permissions.paths);
          // TODO: Implement actual filesystem sandboxing
        }

        result = await localFn.execute(context);
      } else if (task.target_function) {
        // Task explicitly targets a function that is not available on this node
        throw new Error(`Function ${task.target_function} not available on this node`);
      } else {
        // Try to execute as a Rainfall tool
        this.log(`No local function found for ${task.task_name}, trying Rainfall tool`);
        result = await this.rainfall.executeTool(task.task_name, task.task_config || {});
      }

      const executionTime = Date.now() - startTime;

      // Mark task as completed
      await this.updateTaskStatus(task.id, 'completed', { result });

      this.log(`Task ${task.task_name} completed in ${executionTime}ms`);

      // Store result in memory if namespace is specified
      if (task.namespace && task.namespace !== 'default') {
        try {
          await this.rainfall.executeTool('memory-create', {
            content: JSON.stringify(result),
            namespace: task.namespace,
            metadata: {
              task_id: task.id,
              task_name: task.task_name,
              execution_time: executionTime,
            },
          });
          this.log(`Stored result in namespace: ${task.namespace}`);
        } catch (error) {
          this.log('Failed to store result in memory:', error);
        }
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log(`Task ${task.task_name} failed after ${executionTime}ms:`, errorMessage);

      // Mark task as failed
      await this.updateTaskStatus(task.id, 'failed', { error: errorMessage });
    }
  }

  /**
   * Update task status via API
   */
  private async updateTaskStatus(
    taskId: string,
    status: 'running' | 'completed' | 'failed',
    options: { result?: Record<string, unknown>; error?: string } = {}
  ): Promise<void> {
    try {
      const body: Record<string, unknown> = { status };

      if (options.result !== undefined) {
        body.result = options.result;
      }

      if (options.error !== undefined) {
        body.error = options.error;
      }

      await this.rainfall.getClient().request(`/olympic/subscribers/${this.subscriberId}/tasks/${taskId}`, {
        method: 'PATCH',
        body,
      });
    } catch (error) {
      this.log(`Failed to update task status: ${error}`);
    }
  }
}
