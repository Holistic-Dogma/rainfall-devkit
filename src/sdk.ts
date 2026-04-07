/**
 * Main Rainfall SDK class with namespace-based DSL
 */

import { RainfallClient } from './client.js';
import { RainfallConfig } from './types.js';
import { createIntegrations, IntegrationsNamespace } from './namespaces/integrations.js';
import { createMemory } from './namespaces/memory.js';
import { createArticles } from './namespaces/articles.js';
import { createWeb } from './namespaces/web.js';
import { createAI } from './namespaces/ai.js';
import { createData } from './namespaces/data.js';
import { createUtils } from './namespaces/utils.js';
import { createCharts } from './namespaces/charts.js';
import type { Memory, Articles, Web, AI, Data, Utils, Charts } from './types.js';

export class Rainfall {
  private readonly client: RainfallClient;
  private _integrations?: IntegrationsNamespace;
  private _memory?: Memory.MemoryClient;
  private _articles?: Articles.ArticlesClient;
  private _web?: Web.WebClient;
  private _ai?: AI.AIClient;
  private _data?: Data.DataClient;
  private _utils?: Utils.UtilsClient;
  private _charts?: Charts.ChartsClient;

  constructor(config: RainfallConfig) {
    this.client = new RainfallClient(config);
  }

  /**
   * Integrations namespace - GitHub, Notion, Linear, Slack, Figma, Stripe
   * 
   * @example
   * ```typescript
   * // GitHub
   * await rainfall.integrations.github.issues.create({
   *   owner: 'facebook',
   *   repo: 'react',
   *   title: 'Bug report'
   * });
   * 
   * // Slack
   * await rainfall.integrations.slack.messages.send({
   *   channelId: 'C123456',
   *   text: 'Hello team!'
   * });
   * 
   * // Linear
   * const issues = await rainfall.integrations.linear.issues.list();
   * ```
   */
  get integrations(): IntegrationsNamespace {
    if (!this._integrations) {
      this._integrations = createIntegrations(this.client);
    }
    return this._integrations;
  }

  /**
   * Memory namespace - Semantic memory storage and retrieval
   * 
   * @example
   * ```typescript
   * // Store a memory
   * await rainfall.memory.create({
   *   content: 'User prefers dark mode',
   *   keywords: ['preference', 'ui']
   * });
   * 
   * // Recall similar memories
   * const memories = await rainfall.memory.recall({
   *   query: 'user preferences',
   *   topK: 5
   * });
   * ```
   */
  get memory(): Memory.MemoryClient {
    if (!this._memory) {
      this._memory = createMemory(this.client);
    }
    return this._memory;
  }

  /**
   * Articles namespace - News aggregation and article management
   * 
   * @example
   * ```typescript
   * // Search news
   * const articles = await rainfall.articles.search({
   *   query: 'artificial intelligence'
   * });
   * 
   * // Create from URL
   * const article = await rainfall.articles.createFromUrl({
   *   url: 'https://example.com/article'
   * });
   * 
   * // Summarize
   * const summary = await rainfall.articles.summarize({
   *   text: article.content
   * });
   * ```
   */
  get articles(): Articles.ArticlesClient {
    if (!this._articles) {
      this._articles = createArticles(this.client);
    }
    return this._articles;
  }

  /**
   * Web namespace - Web search, scraping, and content extraction
   * 
   * @example
   * ```typescript
   * // Search with Exa
   * const results = await rainfall.web.search.exa({
   *   query: 'latest AI research'
   * });
   * 
   * // Fetch and convert
   * const html = await rainfall.web.fetch({ url: 'https://example.com' });
   * const markdown = await rainfall.web.htmlToMarkdown({ html });
   * 
   * // Extract specific elements
   * const links = await rainfall.web.extractHtml({
   *   html,
   *   selector: 'a[href]'
   * });
   * ```
   */
  get web(): Web.WebClient {
    if (!this._web) {
      this._web = createWeb(this.client);
    }
    return this._web;
  }

  /**
   * AI namespace - Embeddings, image generation, OCR, vision, chat
   * 
   * @example
   * ```typescript
   * // Generate embeddings
   * const embedding = await rainfall.ai.embeddings.document({
   *   text: 'Hello world'
   * });
   * 
   * // Generate image
   * const image = await rainfall.ai.image.generate({
   *   prompt: 'A serene mountain landscape'
   * });
   * 
   * // OCR
   * const text = await rainfall.ai.ocr({ imageBase64: '...' });
   * 
   * // Chat
   * const response = await rainfall.ai.chat({
   *   messages: [{ role: 'user', content: 'Hello!' }]
   * });
   * ```
   */
  get ai(): AI.AIClient {
    if (!this._ai) {
      this._ai = createAI(this.client);
    }
    return this._ai;
  }

  /**
   * Data namespace - CSV processing, scripts, similarity search
   * 
   * @example
   * ```typescript
   * // Query CSV with SQL
   * const results = await rainfall.data.csv.query({
   *   sql: 'SELECT * FROM data WHERE value > 100'
   * });
   * 
   * // Execute saved script
   * const result = await rainfall.data.scripts.execute({
   *   name: 'my-script',
   *   params: { input: 'data' }
   * });
   * ```
   */
  get data(): Data.DataClient {
    if (!this._data) {
      this._data = createData(this.client);
    }
    return this._data;
  }

  /**
   * Utils namespace - Mermaid diagrams, document conversion, regex, JSON extraction
   * 
   * @example
   * ```typescript
   * // Generate diagram
   * const diagram = await rainfall.utils.mermaid({
   *   diagram: 'graph TD; A-->B;'
   * });
   * 
   * // Convert document
   * const pdf = await rainfall.utils.documentConvert({
   *   document: markdownContent,
   *   mimeType: 'text/markdown',
   *   format: 'pdf'
   * });
   * 
   * // Extract JSON from text
   * const json = await rainfall.utils.jsonExtract({
   *   text: 'Here is some data: {"key": "value"}'
   * });
   * ```
   */
  get utils(): Utils.UtilsClient {
    if (!this._utils) {
      this._utils = createUtils(this.client);
    }
    return this._utils;
  }

  /**
   * Charts namespace - Terminal-based chart rendering with finviz data
   *
   * @example
   * ```typescript
   * // Get finviz data for a ticker
   * const candles = await rainfall.charts.finviz.get('AAPL');
   *
   * // Render a candlestick chart
   * const chart = await rainfall.charts.finviz.candlestick('AAPL', {
   *   width: 100,
   *   height: 30,
   *   theme: 'dracula'
   * });
   * console.log(chart);
   *
   * // Quick chart (prints directly)
   * await rainfall.charts.finviz.quick('TSLA');
   *
   * // Render custom data
   * const customChart = rainfall.charts.render.line([
   *   { x: 0, y: 10 },
   *   { x: 1, y: 15 },
   *   { x: 2, y: 12 }
   * ], 'Custom Data');
   * ```
   */
  get charts(): Charts.ChartsClient {
    if (!this._charts) {
      this._charts = createCharts(this.client);
    }
    return this._charts;
  }

  /**
   * Get the underlying HTTP client for advanced usage
   */
  getClient(): RainfallClient {
    return this.client;
  }

  /**
   * List all available tools
   */
  async listTools() {
    return this.client.listTools();
  }

  /**
   * Get schema for a specific tool
   */
  async getToolSchema(toolId: string) {
    return this.client.getToolSchema(toolId);
  }

  /**
   * Execute any tool by ID (low-level access)
   * 
   * @param toolId - The ID of the tool to execute
   * @param params - Parameters to pass to the tool
   * @param options - Execution options including skipValidation to bypass param validation
   * 
   * @example
   * ```typescript
   * // Execute with validation (default)
   * const result = await rainfall.executeTool('finviz-quotes', { tickers: ['AAPL'] });
   * 
   * // Execute without validation
   * const result = await rainfall.executeTool('finviz-quotes', { tickers: ['AAPL'] }, { skipValidation: true });
   * ```
   */
  async executeTool<T = unknown>(
    toolId: string, 
    params?: Record<string, unknown>,
    options?: { skipValidation?: boolean; timeout?: number; retries?: number; retryDelay?: number; targetEdge?: string }
  ) {
    return this.client.executeTool<T>(toolId, params, options);
  }

  /**
   * Validate parameters for a tool without executing it
   * 
   * @param toolId - The ID of the tool to validate params for
   * @param params - Parameters to validate
   * @returns Validation result with detailed error information
   * 
   * @example
   * ```typescript
   * const result = await rainfall.validateToolParams('finviz-quotes', { tickers: ['AAPL'] });
   * if (!result.valid) {
   *   console.log('Validation errors:', result.errors);
   * }
   * ```
   */
  async validateToolParams(toolId: string, params?: Record<string, unknown>) {
    return this.client.validateToolParams(toolId, params);
  }

  /**
   * Get current subscriber info and usage
   */
  async getMe() {
    return this.client.getMe();
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo() {
    return this.client.getRateLimitInfo();
  }

  /**
   * OpenAI-compatible chat completions with tool support
   * 
   * @example
   * ```typescript
   * // Simple chat
   * const response = await rainfall.chatCompletions({
   *   subscriber_id: 'my-subscriber',
   *   messages: [{ role: 'user', content: 'Hello!' }],
   *   model: 'llama-3.3-70b-versatile'
   * });
   * 
   * // With tools
   * const response = await rainfall.chatCompletions({
   *   subscriber_id: 'my-subscriber',
   *   messages: [{ role: 'user', content: 'Search for AI news' }],
   *   tools: [{ type: 'function', function: { name: 'web-search' } }],
   *   enable_stacked: true
   * });
   * 
   * // Streaming
   * const stream = await rainfall.chatCompletions({
   *   subscriber_id: 'my-subscriber',
   *   messages: [{ role: 'user', content: 'Tell me a story' }],
   *   stream: true
   * });
   * ```
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
    return this.client.chatCompletions(params);
  }

  /**
   * List available models (OpenAI-compatible format)
   * 
   * @example
   * ```typescript
   * const models = await rainfall.listModels();
   * console.log(models); // [{ id: 'llama-3.3-70b-versatile', ... }]
   * ```
   */
  async listModels(subscriberId?: string): Promise<Array<{ id: string; [key: string]: unknown }>> {
    return this.client.listModels(subscriberId);
  }

  /**
   * Get tools from the registry (registry-driven tool discovery)
   * 
   * @param namespacePrefix - Namespace prefix to filter by (default: 'tools')
   * @returns Unified tool list from registry
   * 
   * @example
   * ```typescript
   * // Get all tools
   * const result = await rainfall.getRegistryTools();
   * console.log(result.tools); // [{ id: 'tools.rainfall.finviz-quotes', ... }]
   * 
   * // Get only rainfall tools
   * const result = await rainfall.getRegistryTools('tools.rainfall');
   * ```
   */
  async getRegistryTools(namespacePrefix = 'tools'): Promise<{ 
    success: boolean; 
    tools?: Array<{
      id: string;
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      source: { type: string; metadata: Record<string, unknown> };
      visibility: string;
      updated_at: string;
      metadata: Record<string, unknown>;
    }>;
    pagination?: { page: number; per_page: number; total: number };
    error?: string;
  }> {
    return this.client.getRegistryTools(namespacePrefix);
  }
}
