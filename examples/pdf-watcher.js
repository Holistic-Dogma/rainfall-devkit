#!/usr/bin/env node
/**
 * PDF Watcher Example - Passive Listener for Rainfall Daemon
 * 
 * Watches ~/Downloads for new PDF files, OCRs them, summarizes with LLM,
 * and posts results to Slack or terminal.
 * 
 * Usage:
 *   node examples/pdf-watcher.js
 * 
 * Requires:
 *   - Rainfall daemon running (rainfall daemon start)
 *   - RAINFALL_API_KEY configured (rainfall auth login)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const WATCH_PATH = path.join(os.homedir(), 'Downloads');
const PROCESSED_FILES = new Set();

// Load config from ~/.rainfall/config.json
function loadConfig() {
  const configPath = path.join(os.homedir(), '.rainfall', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  console.log('📄 PDF Watcher Example');
  console.log('======================');
  console.log(`Watching: ${WATCH_PATH}`);
  console.log('');

  // Load config
  const config = loadConfig();
  if (!config.apiKey) {
    console.error('❌ No API key configured. Run: rainfall auth login <api-key>');
    process.exit(1);
  }

  // Verify daemon is running
  try {
    const health = await fetch('http://localhost:8787/health');
    if (!health.ok) throw new Error('Daemon not responding');
    const status = await health.json();
    console.log(`✅ Daemon connected (${status.tools_loaded} tools loaded)`);
  } catch {
    console.error('❌ Daemon not running. Start with: rainfall daemon start');
    process.exit(1);
  }

  // Start watching
  console.log('👁️  Starting file watcher...');
  console.log('   (Drop a PDF in ~/Downloads to test)');
  console.log('   Press Ctrl+C to stop');
  console.log('');

  const watcher = fs.watch(WATCH_PATH, { recursive: false }, async (eventType, filename) => {
    if (!filename) return;
    if (path.extname(filename).toLowerCase() !== '.pdf') return;
    if (eventType !== 'rename') return;

    const fullPath = path.join(WATCH_PATH, filename);
    
    // Debounce: wait for file to be fully written
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check file exists and hasn't been processed
    if (!fs.existsSync(fullPath)) return;
    if (PROCESSED_FILES.has(fullPath)) return;
    PROCESSED_FILES.add(fullPath);

    console.log(`📥 New PDF detected: ${filename}`);
    
    try {
      await processPDF(config, fullPath, filename);
    } catch (error) {
      console.error(`❌ Error processing ${filename}:`, error.message);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watcher...');
    watcher.close();
    process.exit(0);
  });
}

async function processPDF(config, fullPath, filename) {
  try {
    // Step 1: Read and OCR the PDF
    console.log('   🔍 OCR extracting text...');
    const pdfBase64 = fs.readFileSync(fullPath).toString('base64');
    
    // Call the OCR tool via daemon
    const ocrResponse = await fetch('http://localhost:8787/v1/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_id: 'ocr-text-extraction',
        params: {
          image: `data:application/pdf;base64,${pdfBase64}`,
        },
      }),
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR failed: ${await ocrResponse.text()}`);
    }

    const ocrResult = await ocrResponse.json();
    const ocrText = ocrResult.result || ocrResult;
    
    console.log(`   ✓ OCR complete (${typeof ocrText === 'string' ? ocrText.length : JSON.stringify(ocrText).length} chars)`);

    // Step 2: Summarize with LLM
    console.log('   📝 Summarizing...');
    
    const textToSummarize = typeof ocrText === 'string' 
      ? ocrText.slice(0, 10000) 
      : JSON.stringify(ocrText).slice(0, 10000);

    const summaryResponse = await fetch('http://localhost:8787/v1/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_id: 'article-summarize',
        params: { text: textToSummarize },
      }),
    });

    if (!summaryResponse.ok) {
      throw new Error(`Summary failed: ${await summaryResponse.text()}`);
    }

    const summaryResult = await summaryResponse.json();
    const summary = summaryResult.result || summaryResult;

    console.log('   ✓ Summary complete');

    // Output result
    outputResult(filename, ocrText, summary);

    // Optional: Post to Slack
    await postToSlack(config, filename, summary);

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
  }
}

function outputResult(filename, ocrText, summary) {
  console.log('');
  console.log('📋 Processing Complete');
  console.log('=====================');
  console.log(`File: ${filename}`);
  console.log(`OCR Length: ${typeof ocrText === 'string' ? ocrText.length : JSON.stringify(ocrText).length} characters`);
  console.log('');
  console.log('Summary:');
  console.log(typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2));
  console.log('');
  console.log('---------------------');
  console.log('');
}

async function postToSlack(config, filename, summary) {
  const slackChannel = process.env.SLACK_CHANNEL_ID;
  if (!slackChannel) return;

  try {
    const summaryText = typeof summary === 'string' ? summary : JSON.stringify(summary);
    
    const response = await fetch('http://localhost:8787/v1/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_id: 'slack-core-postMessage',
        params: {
          channelId: slackChannel,
          text: `📄 PDF Processed: ${filename}\n\n${summaryText.slice(0, 500)}...`,
        },
      }),
    });

    if (response.ok) {
      console.log('📤 Posted to Slack');
    } else {
      console.log('⚠️  Could not post to Slack:', await response.text());
    }
  } catch (error) {
    console.log('⚠️  Could not post to Slack:', error.message);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
