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
