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
  
  async preflight(context) {
    // Convert comma-separated tickers to array
    const { parseValue } = await import('../core/param-parser.js');
    const params = { ...context.params };
    
    if (params.tickers && typeof params.tickers === 'string') {
      params.tickers = parseValue(params.tickers, { type: 'array', items: { type: 'string' } });
    }
    
    return { params };
  },
  
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

// Register all built-in handlers
export function registerBuiltInHandlers(registry: ToolHandlerRegistry = globalHandlerRegistry): void {
  registry.register(imageGenerationHandler);
  registry.register(finvizQuotesHandler);
  registry.register(csvQueryHandler);
  registry.register(webSearchHandler);
  registry.register(memoryRecallHandler);
}

// Auto-register on import
registerBuiltInHandlers();

export { globalHandlerRegistry };
