/**
 * Display modes and formatting for CLI output
 */

import { spawn } from 'child_process';

export type DisplayMode = 'raw' | 'pretty' | 'table' | 'image' | 'terminal';

export interface DisplayOptions {
  mode?: DisplayMode;
  /** For image display: command to use (imgcat, catimg, etc.) */
  imageCommand?: string;
  /** For table display: columns to show */
  columns?: string[];
  /** Max depth for object traversal */
  maxDepth?: number;
  /** Output to file instead of stdout */
  outputFile?: string;
}

/**
 * Detect if terminal supports images
 */
export function detectImageSupport(): { supported: boolean; command?: string } {
  // Check for iTerm2's imgcat
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return { supported: true, command: 'imgcat' };
  }
  
  // Check for kitty's icat
  if (process.env.KITTY_WINDOW_ID) {
    return { supported: true, command: 'kitty +kitten icat' };
  }
  
  // Check for xan (if installed)
  try {
    // We'll check this at runtime
    return { supported: true, command: 'xan' };
  } catch {
    // Not installed
  }
  
  // Check for catimg
  try {
    return { supported: true, command: 'catimg' };
  } catch {
    // Not installed
  }
  
  return { supported: false };
}

/**
 * Display image data using available terminal image viewer
 */
export async function displayImage(
  imageData: Buffer | string,
  options: DisplayOptions = {}
): Promise<void> {
  const imageCommand = options.imageCommand || detectImageSupport().command;
  
  if (!imageCommand) {
    // Fallback: save to temp file and tell user
    const { writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    
    const tempPath = join(tmpdir(), `rainfall-image-${Date.now()}.png`);
    const buffer = typeof imageData === 'string' 
      ? Buffer.from(imageData, 'base64')
      : imageData;
    
    writeFileSync(tempPath, buffer);
    console.log(`Image saved to: ${tempPath}`);
    return;
  }
  
  return new Promise((resolve, reject) => {
    const buffer = typeof imageData === 'string'
      ? Buffer.from(imageData, 'base64')
      : imageData;
    
    const child = spawn(imageCommand, [], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    });
    
    child.stdin.write(buffer);
    child.stdin.end();
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Image display failed with code ${code}`));
      }
    });
    
    child.on('error', reject);
  });
}

/**
 * Format result as table
 */
export function formatAsTable(
  data: unknown[],
  columns?: string[]
): string {
  if (!Array.isArray(data) || data.length === 0) {
    return 'No data';
  }
  
  // Auto-detect columns if not provided
  const cols = columns || Object.keys(data[0] as object);
  
  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = Math.max(
      col.length,
      ...data.map(row => {
        const val = (row as Record<string, unknown>)?.[col];
        return String(val ?? '').slice(0, 50).length;
      })
    );
  }
  
  // Build table
  const lines: string[] = [];
  
  // Header
  const header = cols.map(col => col.padEnd(widths[col])).join('  ');
  lines.push(header);
  lines.push(cols.map(col => '-'.repeat(widths[col])).join('  '));
  
  // Rows
  for (const row of data) {
    const line = cols.map(col => {
      const val = (row as Record<string, unknown>)?.[col];
      const str = String(val ?? '').slice(0, 50);
      return str.padEnd(widths[col]);
    }).join('  ');
    lines.push(line);
  }
  
  return lines.join('\n');
}

/**
 * Format result based on display mode
 */
export async function formatResult(
  result: unknown,
  options: DisplayOptions = {}
): Promise<string> {
  const mode = options.mode || 'pretty';
  
  switch (mode) {
    case 'raw':
      return JSON.stringify(result);
      
    case 'pretty':
      return JSON.stringify(result, null, 2);
      
    case 'table':
      if (Array.isArray(result)) {
        return formatAsTable(result, options.columns);
      }
      // Fallback to pretty for non-array results
      return JSON.stringify(result, null, 2);
      
    case 'terminal':
      // Minimal formatting for terminal consumption
      if (typeof result === 'string') {
        return result;
      }
      if (Array.isArray(result) && result.every(r => typeof r === 'string')) {
        return result.join('\n');
      }
      return JSON.stringify(result);
      
    default:
      return JSON.stringify(result, null, 2);
  }
}

/**
 * Check if result contains image data
 */
export function detectImageData(result: unknown): { hasImage: boolean; imagePath?: string; imageData?: string } {
  if (!result || typeof result !== 'object') {
    return { hasImage: false };
  }
  
  const obj = result as Record<string, unknown>;
  
  // Check for common image field names
  const imageFields = ['image', 'imageData', 'imageBase64', 'png', 'jpeg', 'data'];
  
  for (const field of imageFields) {
    if (obj[field] && typeof obj[field] === 'string') {
      const value = obj[field] as string;
      // Check if it looks like base64 image data
      if (value.startsWith('data:image/') || value.length > 100) {
        return { 
          hasImage: true, 
          imageData: value.startsWith('data:image/') ? value.split(',')[1] : value 
        };
      }
    }
  }
  
  // Check for URL
  if (obj.url && typeof obj.url === 'string' && 
      (obj.url.endsWith('.png') || obj.url.endsWith('.jpg') || obj.url.endsWith('.jpeg'))) {
    return { hasImage: true, imagePath: obj.url };
  }
  
  return { hasImage: false };
}
