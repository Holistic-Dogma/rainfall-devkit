/**
 * Rainfall Daemon Passive Listeners - File watchers, cron triggers, etc.
 * 
 * Provides:
 * - File system watchers for triggering workflows
 * - Cron-style scheduled triggers
 * - Webhook listeners (future)
 * - Event bus for inter-node communication
 */

import { Rainfall } from '../sdk.js';
import { RainfallDaemonContext } from './context.js';
import { RainfallNetworkedExecutor } from './networked.js';

export interface FileWatcherConfig {
  id: string;
  name: string;
  watchPath: string;
  pattern?: string; // glob pattern like "*.pdf"
  events: ('create' | 'modify' | 'delete')[];
  workflow: {
    toolId: string;
    params: Record<string, unknown>;
  }[];
  options?: {
    recursive?: boolean;
    ignoreInitial?: boolean;
    debounceMs?: number;
  };
}

export interface CronTriggerConfig {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  workflow: {
    toolId: string;
    params: Record<string, unknown>;
  }[];
}

export interface ListenerEvent {
  id: string;
  type: 'file' | 'cron' | 'webhook' | 'manual';
  source: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ListenerRegistry {
  fileWatchers: FileWatcherConfig[];
  cronTriggers: CronTriggerConfig[];
}

export class RainfallListenerRegistry {
  private rainfall: Rainfall;
  private context: RainfallDaemonContext;
  private executor: RainfallNetworkedExecutor;
  private watchers = new Map<string, { stop: () => void }>();
  private cronIntervals = new Map<string, NodeJS.Timeout>();
  private eventHistory: ListenerEvent[] = [];
  private maxEventHistory = 100;

  constructor(
    rainfall: Rainfall,
    context: RainfallDaemonContext,
    executor: RainfallNetworkedExecutor
  ) {
    this.rainfall = rainfall;
    this.context = context;
    this.executor = executor;
  }

  /**
   * Register a file watcher
   * Note: Actual file watching requires fs.watch or chokidar
   * This is the registry - actual watching is done by the daemon
   */
  async registerFileWatcher(config: FileWatcherConfig): Promise<void> {
    console.log(`👁️  Registering file watcher: ${config.name} (${config.watchPath})`);

    // Store the watcher config in memory
    const existing = Array.from(this.watchers.keys());
    if (existing.includes(config.id)) {
      await this.unregisterFileWatcher(config.id);
    }

    // For now, we just store the config
    // The actual watching is done by the daemon's startFileWatching method
    this.watchers.set(config.id, {
      stop: () => {
        console.log(`👁️  Stopped file watcher: ${config.name}`);
      },
    });

    // Record registration in context
    await this.context.storeMemory(`File watcher registered: ${config.name}`, {
      keywords: ['listener', 'file-watcher', config.name],
      metadata: { config },
    });
  }

  /**
   * Unregister a file watcher
   */
  async unregisterFileWatcher(id: string): Promise<void> {
    const watcher = this.watchers.get(id);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(id);
    }
  }

  /**
   * Register a cron trigger
   */
  async registerCronTrigger(config: CronTriggerConfig): Promise<void> {
    console.log(`⏰ Registering cron trigger: ${config.name} (${config.cron})`);

    // Clear existing if any
    if (this.cronIntervals.has(config.id)) {
      clearInterval(this.cronIntervals.get(config.id)!);
      this.cronIntervals.delete(config.id);
    }

    // Parse cron (simplified - just supports simple intervals for now)
    // Full cron parsing would require node-cron or similar
    const interval = this.parseCronToMs(config.cron);
    
    if (interval) {
      const intervalId = setInterval(async () => {
        await this.handleCronTick(config);
      }, interval);

      this.cronIntervals.set(config.id, intervalId);
    }

    // Record registration
    await this.context.storeMemory(`Cron trigger registered: ${config.name}`, {
      keywords: ['listener', 'cron', config.name],
      metadata: { config },
    });
  }

  /**
   * Unregister a cron trigger
   */
  unregisterCronTrigger(id: string): void {
    const interval = this.cronIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.cronIntervals.delete(id);
    }
  }

  /**
   * Handle a file event
   */
  async handleFileEvent(
    watcherId: string,
    eventType: 'create' | 'modify' | 'delete',
    filePath: string
  ): Promise<void> {
    const event: ListenerEvent = {
      id: `evt-${Date.now()}`,
      type: 'file',
      source: watcherId,
      timestamp: new Date().toISOString(),
      data: { eventType, filePath },
    };

    this.recordEvent(event);

    // Find the watcher config and execute its workflow
    // This would be looked up from stored config
    console.log(`📁 File event: ${eventType} ${filePath}`);

    // Example workflow execution
    // const config = await this.getWatcherConfig(watcherId);
    // for (const step of config.workflow) {
    //   await this.executor.queueToolExecution(step.toolId, {
    //     ...step.params,
    //     _event: event,
    //   });
    // }
  }

  /**
   * Handle a cron tick
   */
  private async handleCronTick(config: CronTriggerConfig): Promise<void> {
    const event: ListenerEvent = {
      id: `evt-${Date.now()}`,
      type: 'cron',
      source: config.id,
      timestamp: new Date().toISOString(),
      data: { cron: config.cron },
    };

    this.recordEvent(event);
    console.log(`⏰ Cron tick: ${config.name}`);

    // Execute workflow
    for (const step of config.workflow) {
      try {
        await this.executor.queueToolExecution(step.toolId, {
          ...step.params,
          _event: event,
        });
      } catch (error) {
        console.error(`❌ Workflow step failed: ${step.toolId}`, error);
      }
    }
  }

  /**
   * Trigger a manual event (for testing or programmatic triggers)
   */
  async triggerManual(name: string, data: Record<string, unknown> = {}): Promise<void> {
    const event: ListenerEvent = {
      id: `evt-${Date.now()}`,
      type: 'manual',
      source: name,
      timestamp: new Date().toISOString(),
      data,
    };

    this.recordEvent(event);
    console.log(`👆 Manual trigger: ${name}`);

    // Store in context
    await this.context.storeMemory(`Manual trigger fired: ${name}`, {
      keywords: ['trigger', 'manual', name],
      metadata: { event },
    });
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 10): ListenerEvent[] {
    return this.eventHistory.slice(-limit).reverse();
  }

  /**
   * Get active listeners status
   */
  getStatus(): {
    fileWatchers: number;
    cronTriggers: number;
    recentEvents: number;
  } {
    return {
      fileWatchers: this.watchers.size,
      cronTriggers: this.cronIntervals.size,
      recentEvents: this.eventHistory.length,
    };
  }

  /**
   * Stop all listeners
   */
  async stopAll(): Promise<void> {
    // Stop all file watchers
    for (const [id] of this.watchers) {
      await this.unregisterFileWatcher(id);
    }

    // Stop all cron triggers
    for (const [id] of this.cronIntervals) {
      this.unregisterCronTrigger(id);
    }

    console.log('🛑 All listeners stopped');
  }

  private recordEvent(event: ListenerEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(-this.maxEventHistory);
    }
  }

  /**
   * Simple cron parser - converts basic cron expressions to milliseconds
   * Supports: @hourly, @daily, @weekly, and simple intervals like every N minutes
   */
  private parseCronToMs(cron: string): number | null {
    // Special strings
    switch (cron) {
      case '@hourly':
        return 60 * 60 * 1000;
      case '@daily':
        return 24 * 60 * 60 * 1000;
      case '@weekly':
        return 7 * 24 * 60 * 60 * 1000;
      case '@minutely':
        return 60 * 1000;
    }

    // Simple interval parsing: "*/5 * * * *" -> 5 minutes
    const match = cron.match(/^\*\/(\d+)\s/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      if (minutes > 0 && minutes <= 60) {
        return minutes * 60 * 1000;
      }
    }

    // Default: 1 minute for unrecognized patterns
    console.warn(`⚠️  Unrecognized cron pattern "${cron}", using 1 minute interval`);
    return 60 * 1000;
  }
}

/**
 * Create a file watcher workflow helper
 */
export function createFileWatcherWorkflow(
  name: string,
  watchPath: string,
  options: {
    pattern?: string;
    events?: ('create' | 'modify' | 'delete')[];
    workflow: { toolId: string; params: Record<string, unknown> }[];
  }
): FileWatcherConfig {
  return {
    id: `fw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    watchPath,
    pattern: options.pattern,
    events: options.events || ['create'],
    workflow: options.workflow,
  };
}

/**
 * Create a cron trigger workflow helper
 */
export function createCronWorkflow(
  name: string,
  cron: string,
  workflow: { toolId: string; params: Record<string, unknown> }[]
): CronTriggerConfig {
  return {
    id: `cron-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    cron,
    workflow,
  };
}
