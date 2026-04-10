# Rainfall Devkit Installation

## 🚀 Quick Install

### Option 1: NPM (Recommended)
```bash
npm install -g @rainfall-devkit/sdk
```

### Option 2: Nightly Build (Git Install)
```bash
# From local tarball (fastest, no network needed)
cd /path/to/rainfall-devkit
npm install -g ./rainfall-devkit-sdk-0.2.18.tgz

# From GitHub (if npm publish has issues)
npm install -g https://github.com/Holistic-Dogma/rainfall-devkit/releases/download/v0.2.18/rainfall-devkit-sdk-0.2.18.tgz

# Using the install script
curl -L https://raw.githubusercontent.com/Holistic-Dogma/rainfall-devkit/main/install-nightly.sh | bash
```

## ✅ Verification

```bash
rainfall --version
# Output: @rainfall-devkit/sdk v0.2.18

rainfall agent list
# Shows: calliope, regina, solo, rainier (active)
```

## 🤖 Agent System

### List Agents
```bash
rainfall agent list
```

### Switch Active Agent
```bash
rainfall agent switch rainier
```

### Show Agent Details
```bash
rainfall agent show calliope
```

### Chat with Agent
```bash
# Single message
rainfall agent chat "hello, who are you?"

# Interactive REPL mode
rainfall agent chat
```

## 📚 Documentation

- **Full Docs**: https://rainfall-devkit.com/docs
- **Agent System**: https://rainfall-devkit.com/docs/agents
- **CLI Commands**: https://rainfall-devkit.com/docs/cli

## 🔧 Troubleshooting

### Command not found
If `rainfall` command isn't available after installation:

```bash
# Check npm global bin directory
npm config get prefix

# Add to PATH (example for Homebrew)
echo 'export PATH="/opt/homebrew/lib/node_modules/.bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### SSL/TLS Errors (NPM Publish Issues)
If you encounter `ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC`:

1. **Try nightly build** (bypasses npm upload):
   ```bash
   npm install -g https://github.com/Holistic-Dogma/rainfall-devkit/releases/download/v0.2.18/rainfall-devkit-sdk-0.2.18.tgz
   ```

2. **Use local tarball**:
   ```bash
   npm install -g ./rainfall-devkit-sdk-0.2.18.tgz
   ```

3. **Update npm/node**:
   ```bash
   npm install -g npm@latest
   ```

## 🌧️ Development Install

For local development:
```bash
cd /path/to/rainfall-devkit
npm run build
npm link
```

## 📋 Requirements

- **Node.js**: v18+ (v25+ may have SSL issues with npm publish)
- **npm**: v9+ (v11+ may have SSL issues with npm publish)
- **macOS/Linux**: Native support
- **Windows**: WSL recommended

## 🎯 Quick Start

```bash
# Install
npm install -g @rainfall-devkit/sdk

# Setup your agent
rainfall agent switch rainier

# Start chatting
rainfall agent chat "help me get started"
```
