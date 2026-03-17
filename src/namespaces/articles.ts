/**
 * Articles namespace for Rainfall SDK
 * News aggregation and article management
 */

import { RainfallClient } from '../client.js';
import type { Articles } from '../types.js';

export function createArticles(client: RainfallClient): Articles.ArticlesClient {
  return {
    search: (params) => client.executeTool('article-search', params),
    create: (params) => client.executeTool('article-create', params),
    createFromUrl: (params) => client.executeTool('article-create-from-url', params),
    fetch: (params) => client.executeTool('article-fetch', params),
    recent: (params) => client.executeTool('article-recent', params ?? {}),
    relevant: (params) => client.executeTool('article-relevant-news', params),
    summarize: (params) => client.executeTool('article-summarize', params),
    extractTopics: (params) => client.executeTool('article-topic-extractor', params),
  };
}
