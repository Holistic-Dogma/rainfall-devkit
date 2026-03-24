/**
 * Parameter validation for Rainfall SDK
 * Fetches node schemas and validates params before execution
 */

import { RainfallClient } from './client.js';
import { ValidationError } from './errors.js';

export interface ParamSchema {
  type: string;
  description?: string;
  optional?: boolean;
  items?: ParamSchema;
  properties?: Record<string, ParamSchema>;
  [key: string]: unknown;
}

export interface ToolParamsSchema {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, ParamSchema>;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  received?: unknown;
  expected?: string;
}

// Cache for tool schemas to avoid repeated API calls
const schemaCache = new Map<string, { schema: ToolParamsSchema; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and cache tool schema from the API
 */
export async function fetchToolSchema(
  client: RainfallClient,
  toolId: string
): Promise<ToolParamsSchema> {
  const cached = schemaCache.get(toolId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.schema;
  }

  const response = await client.request<{ success: boolean; params: ToolParamsSchema }>(
    `/olympic/subscribers/me/nodes/${toolId}/params`
  );

  if (!response.success || !response.params) {
    throw new ValidationError(`Failed to fetch schema for tool '${toolId}'`);
  }

  schemaCache.set(toolId, { schema: response.params, timestamp: Date.now() });
  return response.params;
}

/**
 * Clear the schema cache (useful for testing or when schemas may have changed)
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

/**
 * Validate params against a tool's schema
 */
export function validateParams(
  schema: ToolParamsSchema,
  params: Record<string, unknown> | undefined,
  toolId: string
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const parameters = schema.parameters || {};

  // Check for missing required parameters
  for (const [key, paramSchema] of Object.entries(parameters)) {
    if (paramSchema.optional !== true && !(key in (params || {}))) {
      errors.push({
        path: key,
        message: `Missing required parameter '${key}'`,
        expected: paramSchema.type,
      });
    }
  }

  // Validate provided parameters
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      const paramSchema = parameters[key];
      
      // Check for unknown parameters
      if (!paramSchema) {
        errors.push({
          path: key,
          message: `Unknown parameter '${key}'`,
          received: value,
        });
        continue;
      }

      // Validate type
      const typeError = validateType(key, value, paramSchema);
      if (typeError) {
        errors.push(typeError);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a value against a parameter schema
 */
function validateType(path: string, value: unknown, schema: ParamSchema): ValidationIssue | null {
  if (value === null || value === undefined) {
    if (schema.optional === true) {
      return null;
    }
    return {
      path,
      message: `Parameter '${path}' is required but received ${value}`,
      received: value,
      expected: schema.type,
    };
  }

  const expectedType = schema.type;
  const actualType = getJsType(value);

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return {
          path,
          message: `Parameter '${path}' must be a string, received ${actualType}`,
          received: value,
          expected: 'string',
        };
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return {
          path,
          message: `Parameter '${path}' must be a number, received ${actualType}`,
          received: value,
          expected: 'number',
        };
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return {
          path,
          message: `Parameter '${path}' must be a boolean, received ${actualType}`,
          received: value,
          expected: 'boolean',
        };
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return {
          path,
          message: `Parameter '${path}' must be an array, received ${actualType}`,
          received: value,
          expected: 'array',
        };
      }
      // Validate array items if schema has items
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemError = validateType(`${path}[${i}]`, value[i], schema.items);
          if (itemError) {
            return itemError;
          }
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {
          path,
          message: `Parameter '${path}' must be an object, received ${actualType}`,
          received: value,
          expected: 'object',
        };
      }
      // Validate object properties if schema has properties
      if (schema.properties) {
        const objValue = value as Record<string, unknown>;
        for (const [propKey, propSchema] of Object.entries(schema.properties)) {
          if (objValue[propKey] !== undefined) {
            const propError = validateType(`${path}.${propKey}`, objValue[propKey], propSchema);
            if (propError) {
              return propError;
            }
          }
        }
      }
      break;

    default:
      // Unknown type - allow it through (API will validate)
      break;
  }

  return null;
}

/**
 * Get JavaScript type name for a value
 */
function getJsType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Format validation errors into a readable message
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return 'No validation errors';
  
  const lines = result.errors.map(err => {
    let line = `  - ${err.message}`;
    if (err.received !== undefined) {
      line += ` (received: ${JSON.stringify(err.received).slice(0, 50)})`;
    }
    return line;
  });
  
  return `Validation failed with ${result.errors.length} error(s):\n${lines.join('\n')}`;
}

/**
 * Validate and throw if invalid
 */
export function validateAndThrow(
  schema: ToolParamsSchema,
  params: Record<string, unknown> | undefined,
  toolId: string
): void {
  const result = validateParams(schema, params, toolId);
  if (!result.valid) {
    throw new ValidationError(
      `Parameter validation failed for tool '${toolId}'`,
      {
        toolId,
        errors: result.errors,
        message: formatValidationErrors(result),
      }
    );
  }
}

/**
 * Create a validating wrapper for executeTool
 */
export function createValidatingExecutor(
  client: RainfallClient,
  enableValidation: boolean = true
) {
  return async function executeWithValidation<T = unknown>(
    toolId: string,
    params?: Record<string, unknown>,
    options?: { skipValidation?: boolean; timeout?: number; retries?: number; retryDelay?: number }
  ): Promise<T> {
    // Skip validation if disabled globally or for this call
    if (enableValidation && !options?.skipValidation) {
      try {
        const schema = await fetchToolSchema(client, toolId);
        validateAndThrow(schema, params, toolId);
      } catch (error) {
        // If we can't fetch the schema (e.g., tool doesn't exist), let the API handle it
        // But if it's a validation error, throw it
        if (error instanceof ValidationError && error.code === 'VALIDATION_ERROR') {
          throw error;
        }
        // Otherwise proceed to API call which will give proper error
      }
    }

    // Proceed with actual execution
    return client.executeTool<T>(toolId, params, options);
  };
}
