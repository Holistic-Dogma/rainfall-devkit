# MCP Proxy Hub

The Rainfall Daemon now includes a full MCP (Model Context Protocol) Proxy Hub that allows external MCP servers (like Chrome DevTools) to connect and expose their tools through the daemon.

## Features

- **Multi-client support**: Connect multiple MCP servers simultaneously
- **Namespacing**: Tools are automatically prefixed with the client name (e.g., `chrome-take_screenshot`)
- **Auto-reconnect**: Automatically reconnects disconnected clients
- **Tool passthrough**: Model calls to MCP tools are forwarded to the appropriate client
- **HTTP API**: Connect/disconnect clients via REST API

## Usage

### Starting the Daemon

```bash
# Start with MCP proxy enabled (default)
rainfall daemon start

# Start with MCP proxy disabled
rainfall daemon start --no-mcp-proxy

# Start with debug logging
rainfall daemon start --debug
```

### Connecting Chrome DevTools MCP

#### Option 1: Via HTTP API

```bash
# Connect Chrome DevTools MCP
curl -X POST http://localhost:8787/v1/mcp/connect \
  -H "Content-Type: application/json" \
  -d '{
    "name": "chrome",
    "transport": "stdio",
    "command": "npx",
    "args": ["@chrome-devtools/mcp@latest"]
  }'

# List connected clients
curl http://localhost:8787/v1/mcp/clients

# Disconnect a client
curl -X POST http://localhost:8787/v1/mcp/disconnect \
  -H "Content-Type: application/json" \
  -d '{"name": "chrome"}'
```

#### Option 2: Via WebSocket MCP Protocol

The daemon's WebSocket endpoint (`ws://localhost:8765`) speaks standard MCP protocol:

```javascript
const ws = new WebSocket('ws://localhost:8765');

ws.onopen = () => {
  // Initialize MCP connection
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'my-client', version: '1.0.0' }
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

#### Option 3: Programmatic (Node.js)

```javascript
import { RainfallDaemon } from '@rainfall-devkit/sdk/daemon';

const daemon = new RainfallDaemon({
  enableMcpProxy: true,
  mcpNamespacePrefix: true,
});

await daemon.start();

// Connect Chrome DevTools
await daemon.connectMCPClient({
  name: 'chrome',
  transport: 'stdio',
  command: 'npx',
  args: ['@chrome-devtools/mcp@latest'],
});

// Now tools like chrome-take_screenshot are available
```

### Using MCP Tools via OpenAI API

Once connected, MCP tools appear in the OpenAI-compatible API:

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Take a screenshot of the current page"}],
    "tools": [{"type": "function", "function": {"name": "chrome_take_screenshot"}}]
  }'
```

### Configuration File

You can pre-configure MCP clients in `~/.rainfall/config.json`:

```json
{
  "apiKey": "your-api-key",
  "llm": {
    "provider": "custom",
    "baseUrl": "http://localhost:1234/v1"
  },
  "mcpClients": [
    {
      "name": "chrome",
      "transport": "stdio",
      "command": "npx",
      "args": ["@chrome-devtools/mcp@latest"],
      "autoConnect": true
    }
  ]
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Rainfall Daemon                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   WebSocket  │  │  OpenAI API  │  │   HTTP Endpoints │  │
│  │   (MCP)      │  │  /v1/chat/*  │  │   /v1/mcp/*      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └─────────────────┼────────────────────┘            │
│                           │                                 │
│                    ┌──────▼──────┐                          │
│                    │  Tool Router │                         │
│                    └──────┬──────┘                          │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐              │
│         │                 │                 │              │
│    ┌────▼────┐     ┌─────▼─────┐    ┌──────▼──────┐       │
│    │ Rainfall│     │   Local   │    │  MCP Proxy  │       │
│    │  Tools  │     │   Tools   │    │    Hub      │       │
│    └─────────┘     └───────────┘    └──────┬──────┘       │
│                                            │               │
│                              ┌─────────────┼─────────────┐ │
│                              │             │             │ │
│                         ┌────▼───┐   ┌────▼───┐   ┌────▼──┐│
│                         │Chrome  │   │ Files  │   │ Other ││
│                         │DevTools│   │ System │   │ MCPs  ││
│                         └────────┘   └────────┘   └───────┘│
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

### MCP Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/mcp/clients` | GET | List connected MCP clients |
| `/v1/mcp/connect` | POST | Connect a new MCP client |
| `/v1/mcp/disconnect` | POST | Disconnect an MCP client |

### Standard Daemon Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with MCP stats |
| `/status` | GET | Full daemon status |
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions |
| `/v1/models` | GET | List available models |

## Namespacing

When `mcpNamespacePrefix` is enabled (default), tools are prefixed with the client name:

- Chrome DevTools `take_screenshot` → `chrome_take_screenshot`
- Filesystem `read_file` → `filesystem_read_file`

This prevents naming collisions when multiple MCP clients have tools with the same name.

## Security Considerations

- MCP clients run with the same permissions as the daemon process
- Be cautious when connecting stdio-based MCP servers
- The daemon does not sandbox MCP tool execution
- For production use, consider running the daemon in a container

## Troubleshooting

### MCP client fails to connect

1. Check that the command/path is correct
2. Ensure the MCP server package is installed (`npm install -g @chrome-devtools/mcp`)
3. Check daemon logs with `--debug` flag

### Tools not appearing

1. Check `/v1/mcp/clients` to verify the client is connected
2. Verify the client supports the `tools/list` MCP method
3. Check daemon logs for errors

### Tool calls failing

1. Verify the tool name is correct (with namespace prefix if enabled)
2. Check that arguments match the tool's input schema
3. Look for errors in the daemon logs
