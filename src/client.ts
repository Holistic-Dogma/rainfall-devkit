/**
 * Core HTTP client for Rainfall SDK
 */

import { RainfallConfig, RequestOptions, RateLimitInfo, ToolSchema } from './types.js';
import {
  RainfallError,
  TimeoutError,
  NetworkError,
  parseErrorResponse,
} from './errors.js';
import { 
  fetchToolSchema, 
  validateParams, 
  formatValidationErrors,
  type ToolParamsSchema,
  type ValidationResult 
} from './validation.js';

const DEFAULT_BASE_URL = 'https://olympic-api.pragma-digital.org/v1';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export class RainfallClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;
  private readonly defaultRetries: number;
  private readonly defaultRetryDelay: number;
  private readonly disableValidation: boolean;
  private lastRateLimitInfo?: RateLimitInfo;
  private subscriberId?: string;

  constructor(config: RainfallConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.defaultTimeout = config.timeout || DEFAULT_TIMEOUT;
    this.defaultRetries = config.retries ?? DEFAULT_RETRIES;
    this.defaultRetryDelay = config.retryDelay || DEFAULT_RETRY_DELAY;
    this.disableValidation = config.disableValidation ?? false;
  }

  apiFetch(route: string, options?: RequestInit) {
    const { headers, ...rest } = options || {};
    return fetch(`${this.baseUrl}/${route}`, {
      ...rest,
      headers: {
        'x-api-key': this.apiKey,
        ...headers,
      }
    });
  }

  /**
   * Get the last rate limit info from the API
   */
  getRateLimitInfo(): RateLimitInfo | undefined {
    return this.lastRateLimitInfo;
  }

  /**
   * Get the base URL for the API
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Make an authenticated request to the Rainfall API
   */
  async request<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
    requestOptions?: RequestOptions
  ): Promise<T> {
    const timeout = requestOptions?.timeout ?? this.defaultTimeout;
    const maxRetries = requestOptions?.retries ?? this.defaultRetries;
    const retryDelay = requestOptions?.retryDelay ?? this.defaultRetryDelay;

    const url = `${this.baseUrl}${path}`;
    const method = options.method || 'GET';

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Rainfall-SDK-Version': '0.1.0',
            ...options.headers,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Update rate limit info from headers
        const limit = response.headers.get('x-ratelimit-limit');
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');

        if (limit && remaining && reset) {
          this.lastRateLimitInfo = {
            limit: parseInt(limit, 10),
            remaining: parseInt(remaining, 10),
            resetAt: new Date(parseInt(reset, 10) * 1000),
          };
        }

        // Parse response
        let data: unknown;
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        // Handle errors
        if (!response.ok) {
          throw parseErrorResponse(response, data);
        }

        return data as T;
      } catch (error) {
        if (error instanceof RainfallError) {
          // Don't retry on client errors (4xx except 429)
          if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
            throw error;
          }
          // Don't retry on auth errors
          if (error.statusCode === 401) {
            throw error;
          }
        }

        // Handle timeout
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new TimeoutError(timeout);
        } else if (error instanceof TypeError) {
          // Network error
          lastError = new NetworkError(error.message);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        // Don't retry on last attempt
        if (attempt >= maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const delay = retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await this.sleep(delay);
      }
    }

    throw lastError || new RainfallError('Request failed', 'REQUEST_FAILED');
  }

  /**
   * Execute a tool/node by ID
   * 
   * @param toolId - The ID of the tool/node to execute
   * @param params - Parameters to pass to the tool
   * @param options - Request options including skipValidation to bypass param validation
   */
  async executeTool<T = unknown>(
    toolId: string,
    params?: Record<string, unknown>,
    options?: RequestOptions & { skipValidation?: boolean; targetEdge?: string }
  ): Promise<T> {
    // Validate params before execution (unless skipped globally or per-call)
    if (!this.disableValidation && !options?.skipValidation) {
      const validation = await this.validateToolParams(toolId, params);
      if (!validation.valid) {
        const { ValidationError } = await import('./errors.js');
        throw new ValidationError(
          `Parameter validation failed for tool '${toolId}': ${formatValidationErrors(validation)}`,
          { toolId, errors: validation.errors }
        );
      }
    }

    const subscriberId = await this.ensureSubscriberId();
    
    // Build request body - include targetEdge if specified
    const body: Record<string, unknown> = params || {};
    if (options?.targetEdge) {
      body._targetEdge = options.targetEdge;
    }
    
    const response = await this.request<{ success: boolean; result: T; error?: string | unknown }>(`/olympic/subscribers/${subscriberId}/nodes/${toolId}`, {
      method: 'POST',
      body,
    }, options);
    
    // Check if the API returned success: false
    if (response.success === false) {
      const errorMessage = typeof response.error === 'string' 
        ? response.error 
        : JSON.stringify(response.error);
      throw new RainfallError(
        `Tool execution failed: ${errorMessage}`,
        'TOOL_EXECUTION_ERROR',
        400,
        { toolId, error: response.error }
      );
    }
    
    return response.result;
  }

  /**
   * Validate parameters for a tool without executing it
   * Fetches the tool schema and validates the provided params
   * 
   * @param toolId - The ID of the tool to validate params for
   * @param params - Parameters to validate
   * @returns Validation result with detailed error information
   * 
   * @example
   * ```typescript
   * const result = await client.validateToolParams('finviz-quotes', { tickers: ['AAPL'] });
   * if (!result.valid) {
   *   console.log('Validation errors:', result.errors);
   * }
   * ```
   */
  async validateToolParams(
    toolId: string,
    params?: Record<string, unknown>
  ): Promise<ValidationResult> {
    try {
      const schema = await fetchToolSchema(this, toolId);
      return validateParams(schema, params, toolId);
    } catch (error) {
      // If we can't fetch the schema, return an error
      if (error instanceof RainfallError && error.statusCode === 404) {
        return {
          valid: false,
          errors: [{ path: toolId, message: `Tool '${toolId}' not found` }],
        };
      }
      // For other errors, assume valid and let the API handle it
      return { valid: true, errors: [] };
    }
  }

  /**
   * List all available tools
   */
  async listTools(): Promise<Array<{ id: string; name: string; description: string; category: string }>> {
    const subscriberId = await this.ensureSubscriberId();
    
    // Use bulk endpoint for efficiency
    const result = await this.request<{ success: boolean; nodes?: Record<string, { id: string; name: string; description: string; category: string }> }>(`/olympic/subscribers/${subscriberId}/nodes/_utils/node-descriptions`);
    
    if (result.success && result.nodes) {
      return Object.values(result.nodes);
    }
    
    // Fallback to legacy endpoint
    const legacyResult = await this.request<{ keys?: string[]; nodes?: Array<{ id: string; name: string; description: string; category: string }> }>(`/olympic/subscribers/${subscriberId}/nodes/_utils/node-list`);
    
    if (legacyResult.keys && Array.isArray(legacyResult.keys)) {
      return legacyResult.keys.map(key => ({
        id: key,
        name: key,
        description: '',
        category: 'general',
      }));
    }
    
    return legacyResult.nodes || [];
  }

  /**
   * Get tool schema/parameters
   * 
   * @param toolId - The ID of the tool to get schema for
   * @returns Tool schema including parameters and output definitions
   */
  async getToolSchema(toolId: string): Promise<ToolSchema> {
    const schema = await fetchToolSchema(this, toolId);
    return {
      name: schema.name,
      description: schema.description,
      category: schema.category,
      parameters: schema.parameters,
      output: schema.output,
      metadata: schema.metadata || {},
    };
  }

  /**
   * Get subscriber info
   */
  async getMe(): Promise<{
    id: string;
    name: string;
    email?: string;
    plan?: string;
    billingStatus?: string;
    usage: {
      callsThisMonth: number;
      callsLimit: number;
    };
  }> {
    const result = await this.request<{ success: boolean; subscriber: { 
      id: string; 
      name: string;
      google_id?: string;
      billing_status?: string;
      metadata?: { usage?: { callsThisMonth?: number; callsLimit?: number } };
    } }>('/olympic/subscribers/me');
    
    // Store subscriber ID for subsequent calls
    if (result.subscriber?.id) {
      this.subscriberId = result.subscriber.id;
    }
    
    // Normalize the response to match expected format
    const subscriber = result.subscriber;
    return {
      id: subscriber.id,
      name: subscriber.name,
      email: subscriber.google_id,
      billingStatus: subscriber.billing_status,
      plan: subscriber.billing_status,
      usage: {
        callsThisMonth: subscriber.metadata?.usage?.callsThisMonth ?? 0,
        callsLimit: subscriber.metadata?.usage?.callsLimit ?? 5000,
      },
    };
  }

  /**
   * Ensure we have a subscriber ID, fetching it if necessary
   */
  private async ensureSubscriberId(): Promise<string> {
    if (this.subscriberId) {
      return this.subscriberId;
    }
    
    const me = await this.getMe();
    if (!me.id) {
      throw new RainfallError('Failed to get subscriber ID', 'NO_SUBSCRIBER_ID');
    }
    return me.id;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * OpenAI-compatible chat completions with tool support
   */
  async chatCompletions(params: {
    subscriber_id: string;
    messages: Array<{ role: string; content: string; name?: string }>;
    model?: string;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    tools?: unknown[];
    tool_choice?: string | { type: string; function?: { name: string } };
    conversation_id?: string;
    agent_name?: string;
    incognito?: boolean;
    tool_priority?: 'local' | 'rainfall' | 'serverside' | 'stacked';
    enable_stacked?: boolean;
  }): Promise<unknown> {
    const { subscriber_id, ...body } = params;
    
    // If streaming, return a ReadableStream
    if (body.stream) {
      const url = `${this.baseUrl}/olympic/subscribers/${subscriber_id}/v1/chat/completions`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new RainfallError(`Chat completions failed: ${error}`, 'CHAT_ERROR');
      }

      if (!response.body) {
        throw new RainfallError('No response body', 'CHAT_ERROR');
      }

      return response.body;
    }

    // Non-streaming request
    return this.request(
      `/olympic/subscribers/${subscriber_id}/v1/chat/completions`,
      {
        method: 'POST',
        body,
      }
    );
  }

  /**
   * List available models (OpenAI-compatible format)
   */
  async listModels(subscriberId?: string): Promise<Array<{ id: string; [key: string]: unknown }>> {
    const sid = subscriberId || this.subscriberId || await this.ensureSubscriberId();
    
    const result = await this.request<{ object: string; data: Array<{ id: string; [key: string]: unknown }> }>(
      `/olympic/subscribers/${sid}/v1/models`
    );
    
    return result.data || [];
  }
}
