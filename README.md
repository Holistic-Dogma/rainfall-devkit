# Rainfall SDK

Official SDK for the Rainfall API - 200+ tools for building AI-powered applications.
Utilities to leverage the backend tools we use for our own applications like [Harmonic](https://harmonic.iswork.in) to bootstrap your own projects.

[![npm version](https://badge.fury.io/js/@rainfall%2Fsdk.svg)](https://www.npmjs.com/package/@rainfall/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **200+ Tools** - GitHub, Notion, Linear, Slack, Figma, Stripe, and more
- **Semantic Memory** - Store and recall information with vector search
- **Web Search** - Exa and Perplexity integration
- **AI Tools** - Embeddings, image generation, OCR, vision, chat
- **Data Processing** - CSV, scripts, similarity search
- **Developer Friendly** - TypeScript, retry logic, error handling
- **MCP Support** - Use with Claude, Cursor, and other AI assistants

## Installation

```bash
npm install @rainfall/sdk
# or
yarn add @rainfall/sdk
# or
bun add @rainfall/sdk
```

## Quick Start

```typescript
import { Rainfall } from '@rainfall/sdk';

const rainfall = new Rainfall({
  apiKey: process.env.RAINFALL_API_KEY!
});

// Search the web
const results = await rainfall.web.search.exa({
  query: 'latest AI breakthroughs'
});

// Create a GitHub issue
await rainfall.integrations.github.issues.create({
  owner: 'facebook',
  repo: 'react',
  title: 'Bug: Something is broken',
  body: 'Detailed description...'
});

// Store and recall memories
await rainfall.memory.create({
  content: 'User prefers dark mode',
  keywords: ['preference', 'ui']
});

const memories = await rainfall.memory.recall({
  query: 'user preferences',
  topK: 5
});
```

## CLI

Install globally to use the CLI:

```bash
npm install -g @rainfall/sdk
```

### Authentication

```bash
rainfall auth login <your-api-key>
```

### List Tools

```bash
rainfall tools list
```

### Execute a Tool

```bash
rainfall run exa-web-search -p '{"query": "AI news"}'
```

### Piping Support

```bash
echo '{"query": "hello"}' | rainfall run exa-web-search
```

## Namespaces

### Integrations

```typescript
// GitHub
await rainfall.integrations.github.issues.create({ owner, repo, title });
await rainfall.integrations.github.repos.get({ owner, repo });

// Notion
await rainfall.integrations.notion.pages.create({ parent, properties });
await rainfall.integrations.notion.databases.query({ databaseId });

// Linear
await rainfall.integrations.linear.issues.create({ title, teamId });
await rainfall.integrations.linear.teams.list();

// Slack
await rainfall.integrations.slack.messages.send({ channelId, text });
await rainfall.integrations.slack.channels.list();

// Figma
await rainfall.integrations.figma.files.get({ fileKey });
await rainfall.integrations.figma.files.getImages({ fileKey, nodeIds });

// Stripe
await rainfall.integrations.stripe.customers.create({ email });
await rainfall.integrations.stripe.paymentIntents.create({ amount, currency });
```

### Memory

```typescript
// Create memory
await rainfall.memory.create({
  content: 'Important information',
  keywords: ['key', 'info'],
  metadata: { source: 'user' }
});

// Recall by similarity
const memories = await rainfall.memory.recall({
  query: 'important information',
  topK: 10
});

// CRUD operations
await rainfall.memory.get({ memoryId: '...' });
await rainfall.memory.update({ memoryId: '...', content: 'Updated' });
await rainfall.memory.delete({ memoryId: '...' });
await rainfall.memory.list();
```

### Articles

```typescript
// Search news
const articles = await rainfall.articles.search({
  query: 'artificial intelligence',
  limit: 10
});

// Create from URL
const article = await rainfall.articles.createFromUrl({ url });

// Summarize
const summary = await rainfall.articles.summarize({
  text: article.content,
  length: 'medium'
});

// Extract topics
const topics = await rainfall.articles.extractTopics({ text });
```

### Web

```typescript
// Search
const exaResults = await rainfall.web.search.exa({ query: '...' });
const perplexityResults = await rainfall.web.search.perplexity({ query: '...' });

// Fetch and convert
const html = await rainfall.web.fetch({ url: 'https://example.com' });
const markdown = await rainfall.web.htmlToMarkdown({ html });

// Extract elements
const links = await rainfall.web.extractHtml({
  html,
  selector: 'a[href]'
});
```

### AI

```typescript
// Embeddings
const docEmbedding = await rainfall.ai.embeddings.document({ text });
const queryEmbedding = await rainfall.ai.embeddings.query({ text });
const imageEmbedding = await rainfall.ai.embeddings.image({ imageBase64 });

// Image generation
const image = await rainfall.ai.image.generate({
  prompt: 'A serene mountain landscape',
  size: '1024x1024'
});

// OCR and Vision
const text = await rainfall.ai.ocr({ imageBase64 });
const analysis = await rainfall.ai.vision({
  imageBase64,
  prompt: 'Describe this image'
});

// Chat and completion
const response = await rainfall.ai.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'grok-2'
});

const completion = await rainfall.ai.complete({
  prompt: 'The quick brown',
  suffix: 'jumps over the lazy dog'
});

// Classification and segmentation
const classification = await rainfall.ai.classify({
  text: 'This is great!',
  labels: ['positive', 'negative', 'neutral']
});

const segments = await rainfall.ai.segment({
  text: longText,
  maxLength: 500
});
```

### Data

```typescript
// CSV operations
const results = await rainfall.data.csv.query({
  sql: 'SELECT * FROM data WHERE value > 100'
});

await rainfall.data.csv.convert({
  data: csvData,
  fromFormat: 'csv',
  toFormat: 'json'
});

// Scripts
await rainfall.data.scripts.create({
  name: 'process-data',
  code: 'return input.map(x => x * 2);',
  language: 'javascript'
});

const result = await rainfall.data.scripts.execute({
  name: 'process-data',
  params: { input: [1, 2, 3] }
});

await rainfall.data.scripts.list();
await rainfall.data.scripts.update({ name, code });
await rainfall.data.scripts.delete({ name });

// Similarity search
const matches = await rainfall.data.similarity.search({
  query: embedding,
  embeddings: corpus,
  topK: 5
});
```

### Utils

```typescript
// Mermaid diagrams
const diagram = await rainfall.utils.mermaid({
  diagram: `
    graph TD
      A[Start] --> B{Decision}
      B -->|Yes| C[Action 1]
      B -->|No| D[Action 2]
  `
});

// Document conversion
const pdf = await rainfall.utils.documentConvert({
  document: markdownContent,
  mimeType: 'text/markdown',
  format: 'pdf'
});

// Regex
const matches = await rainfall.utils.regex.match({
  text: 'Hello 123 world',
  pattern: '\\d+',
  flags: 'g'
});

const replaced = await rainfall.utils.regex.replace({
  text: 'Hello world',
  pattern: 'world',
  replacement: 'universe'
});

// JSON extraction
const json = await rainfall.utils.jsonExtract({
  text: 'Data: {"key": "value"}'
});

// Digest
const hash = await rainfall.utils.digest({ data: 'text to hash' });

// Monte Carlo simulation
const simulation = await rainfall.utils.monteCarlo({
  iterations: 10000,
  formula: 'price * (1 + return)',
  variables: {
    return: { mean: 0.08, stdDev: 0.16 }
  }
});
```

## Error Handling

```typescript
import { Rainfall, RateLimitError, AuthenticationError, NotFoundError } from '@rainfall/sdk';

try {
  await rainfall.integrations.github.issues.get({ owner, repo, issue_number: 999999 });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
    console.log(`Remaining: ${error.remaining}/${error.limit}`);
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof NotFoundError) {
    console.log(`Resource not found: ${error.message}`);
  } else {
    console.log('Unexpected error:', error);
  }
}
```

## MCP Server

Use Rainfall with Claude, Cursor, and other MCP-compatible assistants:

```typescript
import { createRainfallMCPServer } from '@rainfall/sdk/mcp';

const server = createRainfallMCPServer({
  apiKey: process.env.RAINFALL_API_KEY!
});

await server.start();
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rainfall": {
      "command": "npx",
      "args": ["-y", "@rainfall/sdk/mcp"],
      "env": {
        "RAINFALL_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Configuration

```typescript
const rainfall = new Rainfall({
  apiKey: 'your-api-key',
  baseUrl: 'https://custom-endpoint.com/v1', // Optional
  timeout: 60000,  // Request timeout in ms (default: 30000)
  retries: 5,      // Number of retries (default: 3)
  retryDelay: 2000 // Initial retry delay in ms (default: 1000)
});
```

## Rate Limiting

The SDK automatically handles rate limiting with exponential backoff:

```typescript
// Check rate limit info
const info = rainfall.getRateLimitInfo();
console.log(info);
// { limit: 1000, remaining: 950, resetAt: Date }
```

## Examples

### GitHub to Notion Sync

```typescript
// Get GitHub issues
const issues = await rainfall.integrations.github.issues.list({
  owner: 'myorg',
  repo: 'myrepo',
  state: 'open'
});

// Create Notion pages for each issue
for (const issue of issues) {
  await rainfall.integrations.notion.pages.create({
    parent: { database_id: 'my-database-id' },
    properties: {
      Name: { title: [{ text: { content: issue.title } }] },
      'Issue URL': { url: issue.html_url },
      Status: { select: { name: issue.state } }
    }
  });
}
```

### PDF to Estimate

```typescript
// Fetch PDF
const response = await fetch('https://example.com/quote.pdf');
const buffer = await response.arrayBuffer();
const base64 = Buffer.from(buffer).toString('base64');

// Extract text with OCR
const { text } = await rainfall.ai.ocr({ imageBase64: base64 });

// Extract structured data
const estimate = await rainfall.ai.complete({
  prompt: `Extract line items from this quote:\n\n${text}\n\nJSON format:`,
  suffix: ''
});

console.log(JSON.parse(estimate));
```

### Memory Agent

```typescript
// Store conversation context
await rainfall.memory.create({
  content: `User asked about pricing. Explained $9/mo for 100k calls.`,
  keywords: ['pricing', 'conversation'],
  metadata: { userId: 'user-123', timestamp: Date.now() }
});

// Later, recall relevant context
const context = await rainfall.memory.recall({
  query: 'What did I tell the user about pricing?',
  topK: 3
});

// Use context in response
const response = await rainfall.ai.chat({
  messages: [
    { role: 'system', content: 'Previous context: ' + JSON.stringify(context) },
    { role: 'user', content: 'What was our pricing again?' }
  ]
});
```

## License

MIT © Pragma Digital
