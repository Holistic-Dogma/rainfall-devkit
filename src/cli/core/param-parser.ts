/**
 * Smart parameter parser with schema-aware type coercion
 * Handles array interpolation, number/boolean parsing, etc.
 */

import type { ParamSchema as ValidationParamSchema, ToolParamsSchema } from '../../validation.js';

// Re-export for consumers
export type { ValidationParamSchema as ParamSchema };

export interface ParseOptions {
  /** 
   * Enable array interpolation for comma-separated values
   * e.g., --tickers AAPL,GOOGL becomes {tickers: ["AAPL", "GOOGL"]}
   */
  arrayInterpolation?: boolean;
  
  /**
   * Enable number parsing for numeric strings
   * e.g., --count 42 becomes {count: 42} when schema expects number
   */
  numberParsing?: boolean;
  
  /**
   * Enable boolean parsing for boolean-like strings
   * e.g., --enabled true becomes {enabled: true}
   */
  booleanParsing?: boolean;
  
  /**
   * Custom separator for array interpolation (default: ',')
   */
  arraySeparator?: string;
}

const DEFAULT_OPTIONS: ParseOptions = {
  arrayInterpolation: true,
  numberParsing: true,
  booleanParsing: true,
  arraySeparator: ',',
};

/**
 * Parse a CLI argument value based on the expected schema type
 */
export function parseValue(
  value: string,
  schema: ParamSchema | undefined,
  options: ParseOptions = {}
): unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // If no schema, try basic JSON parsing, fallback to string
  if (!schema) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  
  const expectedType = schema.type;
  
  switch (expectedType) {
    case 'array':
      return parseArrayValue(value, schema, opts);
      
    case 'number':
      return parseNumberValue(value, opts);
      
    case 'boolean':
      return parseBooleanValue(value, opts);
      
    case 'string':
      return value;
      
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
      
    default:
      // Unknown type - try JSON parsing
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
  }
}

/**
 * Parse array value with interpolation support
 */
function parseArrayValue(
  value: string,
  schema: ParamSchema,
  options: ParseOptions
): unknown[] | string {
  // If it looks like JSON array, parse it
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      return JSON.parse(value);
    } catch {
      // Fall through to interpolation
    }
  }
  
  // Array interpolation: split by separator
  if (options.arrayInterpolation && value.includes(options.arraySeparator!)) {
    const items = value.split(options.arraySeparator!).map(s => s.trim()).filter(Boolean);
    
    // If schema has items type, parse each item
    if (schema.items) {
      return items.map(item => parseValue(item, schema.items, { ...options, arrayInterpolation: false }));
    }
    
    return items;
  }
  
  // Single item - wrap in array
  if (schema.items) {
    return [parseValue(value, schema.items, { ...options, arrayInterpolation: false })];
  }
  
  return [value];
}

/**
 * Parse number value
 */
function parseNumberValue(value: string, options: ParseOptions): number | string {
  if (!options.numberParsing) {
    return value;
  }
  
  const num = Number(value);
  if (!isNaN(num) && isFinite(num)) {
    return num;
  }
  
  return value;
}

/**
 * Parse boolean value
 */
function parseBooleanValue(value: string, options: ParseOptions): boolean | string {
  if (!options.booleanParsing) {
    return value;
  }
  
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on') {
    return true;
  }
  if (lower === 'false' || lower === 'no' || lower === '0' || lower === 'off') {
    return false;
  }
  
  return value;
}

/**
 * Parse all CLI arguments using schema-aware coercion
 */
export function parseCliArgs(
  args: string[],
  schema: ToolParamsSchema | undefined,
  options: ParseOptions = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parameters = schema?.parameters || {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[++i];
      
      if (value === undefined) {
        // Flag-style boolean (e.g., --verbose)
        params[key] = true;
        continue;
      }
      
      const paramSchema = parameters[key];
      params[key] = parseValue(value, paramSchema, opts);
    }
  }
  
  return params;
}

/**
 * Format a value back to CLI-friendly string (for help text, etc.)
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(formatValueForDisplay).join(',');
  }
  return JSON.stringify(value);
}

/**
 * Generate example usage for a parameter based on its schema
 */
export function generateParamExample(key: string, schema: ParamSchema): string {
  const type = schema.type || 'string';
  
  switch (type) {
    case 'array':
      if (schema.items?.type === 'string') {
        return `--${key} item1,item2,item3`;
      }
      return `--${key} '["item1", "item2"]'`;
      
    case 'number':
      return `--${key} 42`;
      
    case 'boolean':
      return `--${key} true`;
      
    case 'object':
      return `--${key} '{"key": "value"}'`;
      
    default:
      return `--${key} "value"`;
  }
}
