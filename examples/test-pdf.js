#!/usr/bin/env node
/**
 * Quick test of PDF processing via daemon
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const pdfPath = process.argv[2] || path.join(process.env.HOME, 'Downloads', 'test-rainfall.pdf');
  
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF not found:', pdfPath);
    process.exit(1);
  }

  console.log('Testing PDF processing...');
  console.log('File:', pdfPath);
  console.log('');

  // Check daemon
  try {
    const health = await fetch('http://localhost:8787/health');
    const status = await health.json();
    console.log('✅ Daemon connected:', status.tools_loaded, 'tools');
  } catch {
    console.error('❌ Daemon not running');
    process.exit(1);
  }

  // Read PDF
  console.log('Reading PDF...');
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  console.log(`Size: ${pdfBase64.length} bytes base64`);
  console.log('');

  // Test OCR
  console.log('Testing OCR...');
  try {
    const response = await fetch('http://localhost:8787/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen-3.5-9b',
        messages: [
          {
            role: 'user',
            content: `Extract text from this PDF. First 5000 chars of base64: data:application/pdf;base64,${pdfBase64.slice(0, 5000)}`,
          },
        ],
        temperature: 0.1,
      }),
    });

    const result = await response.json();
    console.log('OCR Result:');
    console.log(result.choices?.[0]?.message?.content || 'No content');
  } catch (error) {
    console.error('OCR failed:', error.message);
  }
}

main().catch(console.error);
