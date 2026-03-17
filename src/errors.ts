/**
 * Error classes for Rainfall SDK
 */

export class RainfallError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RainfallError';
    Object.setPrototypeOf(this, RainfallError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class AuthenticationError extends RainfallError {
  constructor(message = 'Invalid API key', details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class RateLimitError extends RainfallError {
  public readonly retryAfter: number;
  public readonly limit: number;
  public readonly remaining: number;
  public readonly resetAt: Date;

  constructor(
    message = 'Rate limit exceeded',
    retryAfter: number = 60,
    limit: number = 0,
    remaining: number = 0,
    resetAt?: Date
  ) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter, limit, remaining });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.limit = limit;
    this.remaining = remaining;
    this.resetAt = resetAt || new Date(Date.now() + retryAfter * 1000);
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ValidationError extends RainfallError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends RainfallError {
  constructor(resource: string, identifier?: string) {
    super(
      `${resource}${identifier ? ` '${identifier}'` : ''} not found`,
      'NOT_FOUND_ERROR',
      404,
      { resource, identifier }
    );
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ServerError extends RainfallError {
  constructor(message = 'Internal server error', statusCode: number = 500) {
    super(message, 'SERVER_ERROR', statusCode);
    this.name = 'ServerError';
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}

export class TimeoutError extends RainfallError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, 'TIMEOUT_ERROR', 408);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class NetworkError extends RainfallError {
  constructor(message = 'Network error', details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class ToolNotFoundError extends RainfallError {
  constructor(toolId: string) {
    super(`Tool '${toolId}' not found`, 'TOOL_NOT_FOUND', 404, { toolId });
    this.name = 'ToolNotFoundError';
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
  }
}

export function parseErrorResponse(response: Response, data: unknown): RainfallError {
  const statusCode = response.status;
  
  // Check for rate limiting headers
  if (statusCode === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
    const limit = parseInt(response.headers.get('x-ratelimit-limit') || '0', 10);
    const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '0', 10);
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : undefined;
    
    return new RateLimitError(
      typeof data === 'object' && data && 'message' in data 
        ? String(data.message) 
        : 'Rate limit exceeded',
      retryAfter,
      limit,
      remaining,
      resetAt
    );
  }

  // Handle specific status codes
  switch (statusCode) {
    case 401:
      return new AuthenticationError(
        typeof data === 'object' && data && 'message' in data 
          ? String(data.message) 
          : 'Invalid API key'
      );
    case 404:
      return new NotFoundError(
        typeof data === 'object' && data && 'resource' in data 
          ? String(data.resource) 
          : 'Resource',
        typeof data === 'object' && data && 'identifier' in data 
          ? String(data.identifier) 
          : undefined
      );
    case 400:
      return new ValidationError(
        typeof data === 'object' && data && 'message' in data 
          ? String(data.message) 
          : 'Invalid request',
        typeof data === 'object' && data && 'details' in data 
          ? data.details as Record<string, unknown> 
          : undefined
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return new ServerError(
        typeof data === 'object' && data && 'message' in data 
          ? String(data.message) 
          : 'Server error',
        statusCode
      );
    default:
      return new RainfallError(
        typeof data === 'object' && data && 'message' in data 
          ? String(data.message) 
          : `HTTP ${statusCode}`,
        'UNKNOWN_ERROR',
        statusCode,
        typeof data === 'object' ? data as Record<string, unknown> : undefined
      );
  }
}
