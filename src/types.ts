/**
 * Core types for the Rainfall SDK
 */

export interface RainfallConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface RequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface ToolSchema {
  name: string;
  description: string;
  category: string;
  parameters: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
}

// Namespace-specific types

export namespace Integrations {
  export interface GitHub {
    issues: {
      create(params: { owner: string; repo: string; title: string; body?: string }): Promise<unknown>;
      list(params: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' }): Promise<unknown>;
      get(params: { owner: string; repo: string; issue_number: number }): Promise<unknown>;
      update(params: { owner: string; repo: string; issue_number: number; title?: string; body?: string; state?: 'open' | 'closed' }): Promise<unknown>;
      addComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
    };
    repos: {
      get(params: { owner: string; repo: string }): Promise<unknown>;
      listBranches(params: { owner: string; repo: string }): Promise<unknown>;
    };
    pullRequests: {
      list(params: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' }): Promise<unknown>;
      get(params: { owner: string; repo: string; pullNumber: number }): Promise<unknown>;
    };
  }

  export interface Notion {
    pages: {
      create(params: { parent: unknown; properties: unknown; children?: unknown[] }): Promise<unknown>;
      retrieve(params: { pageId: string }): Promise<unknown>;
      update(params: { pageId: string; properties: unknown }): Promise<unknown>;
    };
    databases: {
      query(params: { databaseId: string; filter?: unknown; sorts?: unknown[] }): Promise<unknown>;
      retrieve(params: { databaseId: string }): Promise<unknown>;
    };
    blocks: {
      appendChildren(params: { blockId: string; children: unknown[] }): Promise<unknown>;
      retrieveChildren(params: { blockId: string }): Promise<unknown>;
    };
  }

  export interface Linear {
    issues: {
      create(params: { title: string; description?: string; teamId?: string; assigneeId?: string; priority?: number; labels?: string[] }): Promise<unknown>;
      list(params?: { filter?: unknown; orderBy?: string }): Promise<unknown>;
      get(params: { issueId: string }): Promise<unknown>;
      update(params: { issueId: string; title?: string; description?: string; state?: string }): Promise<unknown>;
      archive(params: { issueId: string }): Promise<unknown>;
    };
    teams: {
      list(): Promise<unknown>;
    };
  }

  export interface Slack {
    messages: {
      send(params: { channelId: string; text: string; blocks?: unknown[] }): Promise<unknown>;
      list(params: { channelId: string; limit?: number }): Promise<unknown>;
    };
    channels: {
      list(): Promise<unknown>;
    };
    users: {
      list(): Promise<unknown>;
    };
    reactions: {
      add(params: { channelId: string; timestamp: string; reaction: string }): Promise<unknown>;
    };
  }

  export interface Figma {
    files: {
      get(params: { fileKey: string }): Promise<unknown>;
      getNodes(params: { fileKey: string; nodeIds: string[] }): Promise<unknown>;
      getImages(params: { fileKey: string; nodeIds: string[]; format?: 'png' | 'svg' | 'pdf' }): Promise<unknown>;
      getComments(params: { fileKey: string }): Promise<unknown>;
      postComment(params: { fileKey: string; message: string; nodeId?: string }): Promise<unknown>;
    };
    projects: {
      list(params: { teamId: string }): Promise<unknown>;
      getFiles(params: { projectId: string }): Promise<unknown>;
    };
  }

  export interface Stripe {
    customers: {
      create(params: { email: string; name?: string; metadata?: Record<string, string> }): Promise<unknown>;
      retrieve(params: { customerId: string }): Promise<unknown>;
      update(params: { customerId: string; metadata?: Record<string, string> }): Promise<unknown>;
      listPaymentMethods(params: { customerId: string }): Promise<unknown>;
    };
    paymentIntents: {
      create(params: { amount: number; currency: string; customer?: string }): Promise<unknown>;
      retrieve(params: { paymentIntentId: string }): Promise<unknown>;
      confirm(params: { paymentIntentId: string }): Promise<unknown>;
    };
    subscriptions: {
      create(params: { customer: string; items: unknown[] }): Promise<unknown>;
      retrieve(params: { subscriptionId: string }): Promise<unknown>;
      cancel(params: { subscriptionId: string }): Promise<unknown>;
    };
  }
}

export namespace Memory {
  export interface MemoryClient {
    create(params: { content: string; keywords?: string[]; metadata?: Record<string, unknown> }): Promise<unknown>;
    get(params: { memoryId: string }): Promise<unknown>;
    recall(params: { query: string; topK?: number; threshold?: number }): Promise<unknown>;
    list(params?: { limit?: number; offset?: number }): Promise<unknown>;
    update(params: { memoryId: string; content?: string; metadata?: Record<string, unknown> }): Promise<unknown>;
    delete(params: { memoryId: string }): Promise<unknown>;
  }
}

export namespace Articles {
  export interface ArticlesClient {
    search(params: { query: string; limit?: number }): Promise<unknown>;
    create(params: { title: string; content: string; topics?: string[]; metadata?: Record<string, unknown> }): Promise<unknown>;
    createFromUrl(params: { url: string }): Promise<unknown>;
    fetch(params: { articleId: string }): Promise<unknown>;
    recent(params?: { limit?: number }): Promise<unknown>;
    relevant(params: { query: string; limit?: number }): Promise<unknown>;
    summarize(params: { articleId?: string; text?: string; length?: 'short' | 'medium' | 'long' }): Promise<unknown>;
    extractTopics(params: { text: string }): Promise<unknown>;
  }
}

export namespace Web {
  export interface WebClient {
    search: {
      exa(params: { query: string; numResults?: number; includeDomains?: string[]; excludeDomains?: string[] }): Promise<unknown>;
      perplexity(params: { query: string }): Promise<unknown>;
    };
    fetch(params: { url: string; headers?: Record<string, string> }): Promise<unknown>;
    htmlToMarkdown(params: { html: string; baseUrl?: string }): Promise<unknown>;
    extractHtml(params: { html: string; selector: string }): Promise<unknown>;
  }
}

export namespace AI {
  export interface AIClient {
    embeddings: {
      document(params: { text: string }): Promise<unknown>;
      query(params: { text: string }): Promise<unknown>;
      image(params: { imageBase64: string }): Promise<unknown>;
    };
    image: {
      generate(params: { prompt: string; size?: '256x256' | '512x512' | '1024x1024' }): Promise<unknown>;
    };
    ocr(params: { imageBase64: string }): Promise<unknown>;
    vision(params: { imageBase64: string; prompt?: string }): Promise<unknown>;
    chat(params: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; model?: string }): Promise<unknown>;
    complete(params: { prompt: string; suffix?: string }): Promise<unknown>;
    classify(params: { text: string; labels: string[] }): Promise<unknown>;
    segment(params: { text: string; maxLength?: number }): Promise<unknown[]>;
  }
}

export namespace Data {
  export interface DataClient {
    csv: {
      query(params: { sql: string; csvData?: string; fileId?: string }): Promise<unknown>;
      convert(params: { data: string; fromFormat: string; toFormat: string }): Promise<unknown>;
    };
    scripts: {
      create(params: { name: string; code: string; language?: string }): Promise<unknown>;
      execute(params: { name: string; params?: Record<string, unknown> }): Promise<unknown>;
      list(): Promise<unknown>;
      update(params: { name: string; code: string }): Promise<unknown>;
      delete(params: { name: string }): Promise<unknown>;
    };
    similarity: {
      search(params: { query: number[]; embeddings: number[][]; topK?: number }): Promise<unknown>;
      duckDbSearch(params: { query: number[]; tableName: string }): Promise<unknown>;
    };
  }
}

export namespace Utils {
  export interface UtilsClient {
    mermaid(params: { diagram: string }): Promise<unknown>;
    documentConvert(params: { document: string; mimeType: string; format: string }): Promise<unknown>;
    regex: {
      match(params: { text: string; pattern: string; flags?: string }): Promise<unknown>;
      replace(params: { text: string; pattern: string; replacement: string; flags?: string }): Promise<unknown>;
    };
    jsonExtract(params: { text: string }): Promise<unknown>;
    digest(params: { data: string }): Promise<string>;
    monteCarlo(params: { iterations?: number; formula: string; variables?: Record<string, { mean: number; stdDev: number }> }): Promise<unknown>;
  }
}
