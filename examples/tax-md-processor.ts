/**
 * Tax Markdown Processor
 * 
 * Processes a folder of tax-related markdown files, extracts key facts,
 * and stores them in namespaced memory for later recall.
 * 
 * Usage:
 *   rainfall edge expose-function --file ./tax-md-processor.ts --name tax-md-processor
 *   rainfall task add "process taxes" --config '{"folderPath": "/Users/fall/taxes/2025", "namespace": "tax-2025"}' --schedule "daily 8am"
 */

import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';

interface TaxFact {
  category: string;
  description: string;
  amount?: number;
  date?: string;
  sourceFile: string;
}

export default ({ rainfall }: { rainfall: any }) => {
  return {
    name: "tax-md-processor",
    description: "Processes a folder of tax-related markdown files, extracts key facts (deductions, income, expenses), and stores in namespaced memory",
    schema: {
      type: "object",
      properties: {
        folderPath: {
          type: "string",
          description: "Path to the folder containing markdown files"
        },
        namespace: {
          type: "string",
          description: "Memory namespace to store extracted facts (default: tax-2025)",
          default: "tax-2025"
        }
      },
      required: ["folderPath"]
    },
    async execute(params: { folderPath: string; namespace?: string }) {
      const { folderPath, namespace = 'tax-2025' } = params;
      
      console.log(`📁 Processing tax files from: ${folderPath}`);
      console.log(`📝 Storing results in namespace: ${namespace}`);
      
      try {
        // Read directory
        const files = await readdir(folderPath);
        const mdFiles = files.filter(f => extname(f).toLowerCase() === '.md');
        
        if (mdFiles.length === 0) {
          return {
            success: true,
            processed: 0,
            message: "No markdown files found in folder",
            storedIn: namespace
          };
        }
        
        console.log(`📄 Found ${mdFiles.length} markdown file(s)`);
        
        const allFacts: TaxFact[] = [];
        
        // Process each file
        for (const file of mdFiles) {
          const filePath = join(folderPath, file);
          console.log(`  Processing: ${file}`);
          
          const content = await readFile(filePath, 'utf-8');
          const facts = extractFacts(content, file);
          allFacts.push(...facts);
          
          console.log(`    Extracted ${facts.length} fact(s)`);
        }
        
        // Store facts in memory
        const summary = {
          processedAt: new Date().toISOString(),
          folderPath,
          filesProcessed: mdFiles.length,
          totalFacts: allFacts.length,
          facts: allFacts
        };
        
        // Store summary in memory
        await rainfall.memory.create({
          content: JSON.stringify(summary, null, 2),
          namespace,
          metadata: {
            type: 'tax-summary',
            folderPath,
            processedAt: summary.processedAt
          }
        });
        
        // Store individual facts for granular recall
        for (const fact of allFacts) {
          await rainfall.memory.create({
            content: `[${fact.category}] ${fact.description}${fact.amount ? ` - $${fact.amount}` : ''}`,
            namespace,
            metadata: {
              type: 'tax-fact',
              category: fact.category,
              amount: fact.amount,
              date: fact.date,
              sourceFile: fact.sourceFile
            }
          });
        }
        
        console.log(`✅ Stored ${allFacts.length} fact(s) in namespace: ${namespace}`);
        
        return {
          success: true,
          processed: mdFiles.length,
          factsExtracted: allFacts.length,
          storedIn: namespace,
          summary: {
            byCategory: allFacts.reduce((acc, f) => {
              acc[f.category] = (acc[f.category] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          }
        };
        
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error processing tax files: ${message}`);
        throw new Error(`Failed to process tax files: ${message}`);
      }
    }
  };
};

/**
 * Extract tax facts from markdown content
 */
function extractFacts(content: string, sourceFile: string): TaxFact[] {
  const facts: TaxFact[] = [];
  const lines = content.split('\n');
  
  // Categories to look for
  const categories = [
    { key: 'deduction', label: 'deduction' },
    { key: 'income', label: 'income' },
    { key: 'expense', label: 'expense' },
    { key: 'donation', label: 'donation' },
    { key: 'medical', label: 'medical' },
    { key: 'business', label: 'business' },
    { key: 'charitable', label: 'charitable' }
  ];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Check for category keywords
    for (const cat of categories) {
      if (trimmed.toLowerCase().includes(cat.key)) {
        // Try to extract amount
        const amountMatch = trimmed.match(/\$?([\d,]+\.?\d*)/);
        const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : undefined;
        
        // Try to extract date (YYYY-MM-DD format)
        const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : undefined;
        
        facts.push({
          category: cat.label,
          description: trimmed.replace(/^[-*]\s*/, '').substring(0, 200),
          amount,
          date,
          sourceFile
        });
        
        break; // Only match first category per line
      }
    }
  }
  
  return facts;
}
