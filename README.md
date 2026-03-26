# Rainfall DevKit SDK

**Official TypeScript SDK for the Rainfall platform — 200+ production-grade AI tools in one secure API key.**

Built to power real workflows: RAG pipelines, multi-node orchestration (better than n8n in my opinion), document intelligence, web research, financial analysis, and more.

### Pricing & Access
This is **not a free tool**.  
The Rainfall backend runs real infrastructure (LLMs, embeddings, search engines, secure edge nodes, etc.), so we charge a fair price.

- **Indie Tier**: $9/month — 60 requests per minute + usage credits (metered overages coming soon)  
- Higher tiers and prepaid credit packs available soon

Your API key gives you immediate access after purchase. No hidden fees for the core tools.

### Quick Start

```bash
npm install @rainfall-devkit/sdk
```

```ts
import { Rainfall } from '@rainfall-devkit/sdk';

const rainfall = new Rainfall({
  apiKey: process.env.RAINFALL_API_KEY!,     // from your purchase
  // subscriberId optional for some advanced flows
});

const result = await rainfall.web.search("latest AI chip market news");
console.log(result);
```

Or use the CLI:
```bash
rainfall auth login <your-api-key>
rainfall tools list
rainfall run exa-web-search -p '{"query": "something cool"}'
```

Head to [Rainfall Studio](https://rainfall-studio.pragma-digital.com) for documentation and more - and you can run the tools there directly once you have your API key.

### Features

- **Integrations** — GitHub, Notion, Linear, Slack, Figma, Stripe (same nodes that power our own purchase flows)
- **Memory & Knowledge** — Keyword + vector search (Jina embeddings), entity relations
- **Web Research** — Exa, Perplexity, Groq-powered compound mini
- **AI Tools** — OCR on PDFs/images (Mistral), vision, full OpenAI-compatible `/chat/completions` endpoint, local → Rainfall tool chaining
- **Data Processing** — CSV/JSON handling, DuckDB, document conversion (PDF → markdown/text/CSV), similarity search
- **Financial Tools** — Finviz quotes, SEC XBRL (10-Qs), Monte Carlo simulations
- **Developer Experience** — Full TypeScript, automatic retries, clear error types (`RateLimitError`, `AuthenticationError`, etc.), MCP support for Claude/Cursor/Windsurf/etc.
- **Distributed Execution** — Secure edge nodes, MCP proxy hub, job queuing across machines

Some tools (e.g. certain LLM calls) require your own provider keys for cost control or privacy — the SDK makes layering them trivial.

### Note from Fall

Hey, I’m Fall — this SDK contains the exact tools I use daily to run my own company (Harmonic, Rainfall itself, etc.).  
I built it because I got tired of gluing together 17 different services with brittle scripts.

If something doesn’t work as documented, or a tool you need is missing, email me at **fall@pragma-digital.com**. I promise I’ll fix it fast — this is how I eat, so I take it seriously.

We’re just getting started. Usage-based metering, higher tiers, desktop app, and on-prem options are already in the pipeline.

Thanks for betting on us.

— Fall

---

[![npm version](https://badge.fury.io/js/@rainfall-devkit%2Fsdk.svg)](https://www.npmjs.com/package/@rainfall-devkit/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
