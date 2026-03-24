#!/usr/bin/env tsx
/**
 * PDF Watcher Example - Passive Listener for Rainfall Daemon
 * 
 * Watches ~/Downloads for new PDF files, OCRs them, summarizes with LLM,
 * and posts results to Slack or terminal.
 * 
 * Usage:
 *   tsx examples/pdf-watcher.ts
 * 
 * Requires:
 *   - Rainfall daemon running (rainfall daemon start)
 *   - RAINFALL_API_KEY configured
 */

import { Rainfall } from '../src/sdk.js';
import { loadConfig } from '../src/cli/config.js';
import { watch } from 'fs';
import { join, extname, basename } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';

// Configuration
const WATCH_PATH = join(homedir(), 'Downloads');
const PROCESSED_FILES = new Set<string>();

interface PDFProcessingResult {
  filename: string;
  ocrText?: string;
  summary?: string;
  error?: string;
}

async function main() {
  console.log('📄 PDF Watcher Example');
  console.log('======================');
  console.log(`Watching: ${WATCH_PATH}`);
  console.log('');

  // Load config and initialize SDK
  const config = loadConfig();
  if (!config.apiKey) {
    console.error('❌ No API key configured. Run: rainfall auth login <api-key>');
    process.exit(1);
  }

  const rainfall = new Rainfall({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  // Verify daemon is running
  try {
    const health = await fetch('http://localhost:8787/health');
    if (!health.ok) throw new Error('Daemon not responding');
    console.log('✅ Daemon connected');
  } catch {
    console.error('❌ Daemon not running. Start with: rainfall daemon start');
    process.exit(1);
  }

  // Start watching
  console.log('👁️  Starting file watcher...');
  console.log('   (Drop a PDF in ~/Downloads to test)');
  console.log('   Press Ctrl+C to stop');
  console.log('');

  const watcher = watch(WATCH_PATH, { recursive: false }, async (eventType, filename) => {
    if (!filename) return;
    if (extname(filename).toLowerCase() !== '.pdf') return;
    if (eventType !== 'rename') return; // 'rename' is fired for new files

    const fullPath = join(WATCH_PATH, filename);
    
    // Debounce: wait for file to be fully written
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check file exists and hasn't been processed
    if (!existsSync(fullPath)) return;
    if (PROCESSED_FILES.has(fullPath)) return;
    PROCESSED_FILES.add(fullPath);

    console.log(`📥 New PDF detected: ${filename}`);
    
    try {
      const result = await processPDF(rainfall, fullPath, filename);
      await outputResult(result);
    } catch (error) {
      console.error(`❌ Error processing ${filename}:`, error);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watcher...');
    watcher.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    watcher.close();
    process.exit(0);
  });
}

async function processPDF(
  rainfall: Rainfall,
  fullPath: string,
  filename: string
): Promise<PDFProcessingResult> {
  const result: PDFProcessingResult = { filename };

  try {
    // Step 1: Read and OCR the PDF
    console.log('   🔍 OCR extracting text...');
    const pdfBase64 = readFileSync(fullPath).toString('base64');
    
    // Use the daemon's OCR tool
    const ocrResult = await fetch('http://localhost:8787/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local',
        messages: [
          {
            role: 'user',
            content: `OCR this PDF and extract all text. PDF base64: data:application/pdf;base64,${pdfBase64.slice(0, 1000)}...`,
          },
        ],
      }),
    });

    // Actually use the proper tool via SDK
    const toolResult = await rainfall.executeTool('ocr-text-extraction', {
      image: `data:application/pdf;base64,${pdfBase64}`,
    });

    result.ocrText = typeof toolResult === 'string' 
      ? toolResult 
      : JSON.stringify(toolResult, null, 2);

    console.log(`   ✓ OCR complete (${result.ocrText.length} chars)`);

    // Step 2: Summarize with LLM
    console.log('   📝 Summarizing...');
    const summaryResult = await rainfall.executeTool('article-summarize', {
      text: result.ocrText.slice(0, 10000), // Limit text length
    });

    result.summary = typeof summaryResult === 'string'
      ? summaryResult
      : JSON.stringify(summaryResult, null, 2);

    console.log('   ✓ Summary complete');

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function outputResult(result: PDFProcessingResult): Promise<void> {
  console.log('');
  console.log('📋 Processing Complete');
  console.log('=====================');
  console.log(`File: ${result.filename}`);
  
  if (result.error) {
    console.log(`Error: ${result.error}`);
  } else {
    console.log(`OCR Length: ${result.ocrText?.length || 0} characters`);
    console.log('');
    console.log('Summary:');
    console.log(result.summary || 'No summary generated');
  }
  
  console.log('');
  console.log('---------------------');
  console.log('');

  // Optional: Post to Slack if configured
  const slackChannel = process.env.SLACK_CHANNEL_ID;
  if (slackChannel && !result.error) {
    try {
      const config = loadConfig();
      const rainfall = new Rainfall({
        apiKey: config.apiKey!,
        baseUrl: config.baseUrl,
      });

      await rainfall.executeTool('slack-core-postMessage', {
        channelId: slackChannel,
        text: `📄 PDF Processed: ${result.filename}\n\n${result.summary?.slice(0, 500)}...`,
      });
      
      console.log('📤 Posted to Slack');
    } catch (error) {
      console.log('⚠️  Could not post to Slack:', error);
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
