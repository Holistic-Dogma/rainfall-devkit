/**
 * Web namespace for Rainfall SDK
 * Web search, scraping, and content extraction
 */

import { RainfallClient } from '../client.js';
import type { Web } from '../types.js';

export function createWeb(client: RainfallClient): Web.WebClient {
  return {
    search: {
      exa: (params) => client.executeTool('exa-web-search', params),
      perplexity: (params) => client.executeTool('perplexity-search', params),
    },
    fetch: (params) => client.executeTool('web-fetch', params),
    htmlToMarkdown: (params) => client.executeTool('html-to-markdown-converter', params),
    extractHtml: (params) => client.executeTool('extract-html-selector', params),
  };
}
