<p align="center">
  <img src="https://raw.githubusercontent.com/Holistic-Dogma/rainfall-devkit/main/docs/assets/rainfall-logo.png" alt="Rainfall" width="360" />
</p>

<h1 align="center">Rainfall DevKit</h1>

<p align="center"><strong>A friendly TypeScript SDK and CLI for bringing Rainfall's AI tools into the things you build.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rainfall-devkit/sdk"><img src="https://badge.fury.io/js/@rainfall-devkit%2Fsdk.svg" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
</p>

Whether you are trying one useful tool or wiring together a bigger workflow, you are welcome here. Rainfall gives your app one API for web research, documents, data work, integrations, AI, and secure edge execution.

![Rainfall's live public tool registry](https://raw.githubusercontent.com/Holistic-Dogma/rainfall-devkit/main/docs/assets/rainfall-registry.png)

## Start here — about five minutes

**1. Install the package.**

```bash
npm install @rainfall-devkit/sdk
```

**2. Add your Rainfall API key.** Get one from [Rainfall Studio](https://rainfall-studio.pragma-digital.com), then set it in your shell:

```bash
export RAINFALL_API_KEY="your-api-key"
```

**3. Make your first call.** Create `rainfall.ts`:

```ts
import { Rainfall } from '@rainfall-devkit/sdk';

const rainfall = new Rainfall({ apiKey: process.env.RAINFALL_API_KEY! });
const result = await rainfall.web.search('latest AI chip market news');

console.log(result);
```

Run it with your preferred TypeScript runner. That is it — from here, the same client exposes the rest of the platform.

## Prefer the command line?

The `rainfall` command arrives with the package. Sign in once, browse the available tools, then run one.

```bash
rainfall auth login "$RAINFALL_API_KEY"
rainfall tools list
rainfall run exa-web-search -p '{"query":"something cool"}'
```

![The Rainfall CLI help screen](https://raw.githubusercontent.com/Holistic-Dogma/rainfall-devkit/main/docs/assets/rainfall-cli-help.png)

Use `rainfall help` whenever you need a nudge. It lists commands for authentication, tool discovery, workflows, the daemon, and edge nodes.

## What can I build?

- **Research and knowledge** — web search, document intelligence, vector and keyword retrieval, and entity relations.
- **Connected workflows** — GitHub, Notion, Linear, Slack, Figma, Stripe, and more in one toolkit.
- **AI and data tasks** — OCR, vision, OpenAI-compatible chat, CSV/JSON handling, DuckDB, conversions, and similarity search.
- **Production operations** — typed errors and retries, MCP support, secure edge nodes, a daemon, and distributed job execution.

Some tools use your own provider credentials so you can keep control of cost and privacy. The SDK is designed to make that layering straightforward.

## Need a hand?

Visit [Rainfall Studio](https://rainfall-studio.pragma-digital.com) to explore the platform and run tools in the browser. If something is confusing or missing, email [fall@pragma-digital.com](mailto:fall@pragma-digital.com). We want your first workflow to feel pleasantly uneventful.

## Configuration

The SDK defaults to `https://rainfall.pragma-digital.org/v1`. Override it only when you need to target a compatible deployment:

```ts
const rainfall = new Rainfall({
  apiKey: process.env.RAINFALL_API_KEY!,
  baseUrl: 'https://rainfall.pragma-digital.org/v1',
});
```
