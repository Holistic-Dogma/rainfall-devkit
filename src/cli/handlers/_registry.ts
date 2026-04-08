/**
 * Tool handler registry with auto-discovery
 *
 * Handlers in this directory are automatically registered.
 * Naming convention: {tool-id}.ts (e.g., finviz-quotes.ts)
 *
 * Each handler file should export a default ToolHandler or an array of handlers.
 */

import { ToolHandler, ToolHandlerRegistry } from '../core/types.js';
import { globalHandlerRegistry } from '../core/types.js';
import { fetchToolSchema, type ToolParamsSchema } from '../../validation.js';
import { parseValue } from '../core/param-parser.js';

// Generic handler for array parameter conversion using tool schema
// This handles comma-separated strings to array conversion dynamically
const genericArrayParameterHandler: ToolHandler = {
  toolId: /.*/, // Apply to all tools

  async preflight(context) {
    const { rainfall, toolId, params } = context;

    try {
      // Get the client and fetch the tool schema to get parameter types
      const client = rainfall.getClient();
      const schema = await fetchToolSchema(client, toolId);
      const parameters = schema.parameters || {};
      const modifiedParams = { ...params };

      // Process each parameter according to its schema
      for (const [paramName, paramValue] of Object.entries(params)) {
        const paramSchema = parameters[paramName];

        // Only process if we have a schema and the value is a string that needs conversion
        if (paramSchema && typeof paramValue === 'string') {
          const expectedType = paramSchema.type;

          // Handle array type parameters
          if (expectedType === 'array') {
            // Check if it's not already a JSON array (could be comma-separated)
            if (!paramValue.startsWith('[')) {
              modifiedParams[paramName] = parseValue(paramValue, paramSchema);
            }
          }
          // Handle number type parameters
          else if (expectedType === 'number') {
            modifiedParams[paramName] = parseValue(paramValue, paramSchema);
          }
          // Handle boolean type parameters
          else if (expectedType === 'boolean') {
            modifiedParams[paramName] = parseValue(paramValue, paramSchema);
          }
        }
      }

      return { params: modifiedParams };
    } catch (error) {
      // If we can't fetch the schema, just continue with original params
      // The API will handle any validation issues
      return { params };
    }
  },
};

// Import built-in handlers
// These are explicitly imported for type safety and tree-shaking

// Image generation handler (example)
const imageGenerationHandler: ToolHandler = {
  toolId: /image-generation|generate-image/,
  
  async display(context) {
    const { detectImageData, displayImage } = await import('../core/display.js');
    const { result, flags } = context;
    
    // Check if result contains image data
    const imageInfo = detectImageData(result);
    
    if (imageInfo.hasImage && !flags.raw) {
      try {
        if (imageInfo.imageData) {
          await displayImage(imageInfo.imageData);
          return true;
        }
      } catch (error) {
        // Fall through to default display
        console.warn('Failed to display image:', error instanceof Error ? error.message : error);
      }
    }
    
    return false; // Use default display
  },
};

// Finviz quotes handler - table display
const finvizQuotesHandler: ToolHandler = {
  toolId: 'finviz-quotes',

  async display(context) {
    const { result, flags } = context;

    if (flags.raw) {
      return false; // Use default
    }

    // Display quotes as table
    const obj = result as Record<string, unknown>;
    const quotes = obj?.quotes;

    if (Array.isArray(quotes) && quotes.length > 0) {
      const { formatAsTable } = await import('../core/display.js');

      // Extract relevant fields for table
      const tableData = quotes.map((q: unknown) => {
        const quote = q as Record<string, unknown>;
        const data = quote.data as Record<string, unknown> || {};
        return {
          Ticker: quote.ticker || data.Ticker || '-',
          Price: data.Price || data.Close || '-',
          Change: data.Change || '-',
          Volume: data.Volume || '-',
          'Market Cap': data.MarketCap || '-',
        };
      });

      console.log(formatAsTable(tableData));

      // Show summary if available
      const summary = obj?.summary;
      if (summary && typeof summary === 'string') {
        console.log(`\n${summary}`);
      }

      return true;
    }

    return false;
  },
};

// CSV query handler - table display
const csvQueryHandler: ToolHandler = {
  toolId: /query-csv|csv-query/,
  
  async display(context) {
    const { result, flags } = context;
    
    if (flags.raw) {
      return false;
    }
    
    // If result looks like tabular data, display as table
    if (Array.isArray(result) && result.length > 0) {
      const { formatAsTable } = await import('../core/display.js');
      console.log(formatAsTable(result));
      return true;
    }
    
    return false;
  },
};

// Web search handler - pretty print with sources
const webSearchHandler: ToolHandler = {
  toolId: /web-search|exa-web-search|perplexity/,
  
  async display(context) {
    const { result, flags } = context;
    
    if (flags.raw) {
      return false;
    }
    
    const obj = result as Record<string, unknown>;
    
    // Handle markdown results
    if (obj.results && typeof obj.results === 'string') {
      console.log(obj.results);
      return true;
    }
    
    // Handle structured results
    if (obj.answer || obj.summary) {
      console.log(obj.answer || obj.summary);
      
      if (obj.sources && Array.isArray(obj.sources)) {
        console.log('\n--- Sources ---');
        obj.sources.forEach((source: unknown, i: number) => {
          if (typeof source === 'string') {
            console.log(`  ${i + 1}. ${source}`);
          } else if (source && typeof source === 'object') {
            const s = source as Record<string, unknown>;
            console.log(`  ${i + 1}. ${s.title || s.url || JSON.stringify(source)}`);
          }
        });
      }
      
      return true;
    }
    
    return false;
  },
};

// Memory recall handler - formatted list
const memoryRecallHandler: ToolHandler = {
  toolId: /memory-recall|recall/,

  async display(context) {
    const { result, flags } = context;

    if (flags.raw) {
      return false;
    }

    if (Array.isArray(result)) {
      if (result.length === 0) {
        console.log('No memories found.');
        return true;
      }

      console.log(`Found ${result.length} memory(s):\n`);

      result.forEach((mem: unknown, i: number) => {
        const memory = mem as Record<string, unknown>;
        console.log(`─`.repeat(60));
        console.log(`  ${i + 1}. ${memory.content || memory.text || JSON.stringify(memory).slice(0, 100)}`);
        if (memory.similarity) {
          console.log(`     Similarity: ${(Number(memory.similarity) * 100).toFixed(1)}%`);
        }
        if (memory.keywords && Array.isArray(memory.keywords)) {
          console.log(`     Keywords: ${memory.keywords.join(', ')}`);
        }
        console.log();
      });

      return true;
    }

    return false;
  },
};

// Memory create handler - removed, now handled by generic array parameter handler
const memoryCreateHandler: ToolHandler = {
  toolId: 'memory-create',
  // No special handling needed - handled by generic array parameter conversion
};

// Import and register Google handler
import { googleToolHandler } from './google.js';

// Register all built-in handlers
export function registerBuiltInHandlers(registry: ToolHandlerRegistry = globalHandlerRegistry): void {
  // Register generic handlers first (lower priority)
  registry.register(genericArrayParameterHandler);

  // Register specific handlers
  registry.register(imageGenerationHandler);
  registry.register(finvizQuotesHandler);
  registry.register(csvQueryHandler);
  registry.register(webSearchHandler);
  registry.register(memoryRecallHandler);
  registry.register(memoryCreateHandler);
  registry.register(googleToolHandler);
}

// Auto-register on import
registerBuiltInHandlers();

export { globalHandlerRegistry };
