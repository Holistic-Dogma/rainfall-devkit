/**
 * Rainfall SDK - Official SDK for Rainfall API
 * 
 * @example
 * ```typescript
 * import { Rainfall } from '@rainfall/sdk';
 * 
 * const rainfall = new Rainfall({ apiKey: 'your-api-key' });
 * 
 * // Use namespace-based DSL
 * const issues = await rainfall.integrations.github.issues.list({
 *   owner: 'facebook',
 *   repo: 'react'
 * });
 * 
 * // Search web
 * const results = await rainfall.web.search.exa({ query: 'AI news' });
 * 
 * // Store and recall memories
 * await rainfall.memory.create({ content: 'Important info' });
 * const memories = await rainfall.memory.recall({ query: 'important' });
 * ```
 */

// Core exports
export { RainfallClient } from './client.js';
export { Rainfall } from './sdk.js';

// Error exports
export {
  RainfallError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  ServerError,
  TimeoutError,
  NetworkError,
  ToolNotFoundError,
} from './errors.js';

// Type exports
export type {
  RainfallConfig,
  RequestOptions,
  ApiResponse,
  ApiError,
  RateLimitInfo,
  ToolSchema,
} from './types.js';

// Validation exports
export {
  fetchToolSchema,
  validateParams,
  formatValidationErrors,
  clearSchemaCache,
  type ParamSchema,
  type ToolParamsSchema,
  type ValidationResult,
  type ValidationIssue,
} from './validation.js';

// Namespace types
export type {
  Integrations,
  Memory,
  Articles,
  Web,
  AI,
  Data,
  Utils,
} from './types.js';

// Version
export const VERSION = '0.1.0';

// Daemon service exports (for programmatic use)
export {
  RainfallNetworkedExecutor,
  type NodeCapabilities,
  type EdgeNodeRegistration,
  type QueuedJob,
  type NetworkedExecutorOptions,
} from './services/networked.js';

export {
  RainfallDaemonContext,
  type MemoryEntry,
  type SessionContext,
  type ToolExecutionRecord,
  type ContextOptions,
} from './services/context.js';

export {
  RainfallListenerRegistry,
  createFileWatcherWorkflow,
  createCronWorkflow,
  type FileWatcherConfig,
  type CronTriggerConfig,
  type ListenerEvent,
  type ListenerRegistry,
} from './services/listeners.js';

// Security exports
export {
  EdgeNodeSecurity,
  createEdgeNodeSecurity,
  SecureEdgeClient,
  createSecureEdgeClient,
  type EdgeNodeJWT,
  type JWTPayload,
  type ACLCheck,
  type ACLResult,
  type EncryptedPayload,
  type KeyPair,
  type SecureJob,
  type JobResult,
  type SecureEdgeConfig,
} from './security/index.js';

// CLI extension exports (for custom tool handlers)
export type {
  ToolContext,
  PreflightResult,
  PostflightContext,
  DisplayContext,
  ToolHandler,
  ToolHandlerRegistry,
} from './cli/core/types.js';

export {
  globalHandlerRegistry,
} from './cli/handlers/_registry.js';
