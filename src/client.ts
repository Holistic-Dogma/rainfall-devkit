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
  private lastRateLimitInfo?: RateLimitInfo;
  private subscriberId?: string;

  constructor(config: RainfallConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.defaultTimeout = config.timeout || DEFAULT_TIMEOUT;
    this.defaultRetries = config.retries ?? DEFAULT_RETRIES;
    this.defaultRetryDelay = config.retryDelay || DEFAULT_RETRY_DELAY;
  }

  /**
   * Get the last rate limit info from the API
   */
  getRateLimitInfo(): RateLimitInfo | undefined {
    return this.lastRateLimitInfo;
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
   */
  async executeTool<T = unknown>(
    toolId: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const subscriberId = await this.ensureSubscriberId();
    return this.request<T>(`/olympic/subscribers/${subscriberId}/nodes/${toolId}`, {
      method: 'POST',
      body: params,
    }, options);
  }

  /**
   * List all available tools
   */
  async listTools(): Promise<Array<{ id: string; name: string; description: string; category: string }>> {
    const subscriberId = await this.ensureSubscriberId();
    const result = await this.request<{ keys?: string[]; nodes?: Array<{ id: string; name: string; description: string; category: string }> }>(`/olympic/subscribers/${subscriberId}/nodes/_utils/node-list`);
    
    // API returns { keys: [...] } with tool IDs, map to expected format
    if (result.keys && Array.isArray(result.keys)) {
      return result.keys.map(key => ({
        id: key,
        name: key,
        description: '',
        category: 'general',
      }));
    }
    
    // Fallback to nodes format if that's what the API returns
    return result.nodes || [];
  }

  /**
   * Get tool schema/parameters
   */
  async getToolSchema(toolId: string): Promise<ToolSchema> {
    const subscriberId = await this.ensureSubscriberId();
    return this.request(`/olympic/subscribers/${subscriberId}/nodes/${toolId}/params`);
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
}
