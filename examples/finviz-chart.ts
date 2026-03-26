#!/usr/bin/env bun
/**
 * Example: Using the Charts namespace to render finviz data
 *
 * Usage:
 *   bun run examples/finviz-chart.ts AAPL
 *   bun run examples/finviz-chart.ts TSLA --line
 *   bun run examples/finviz-chart.ts MSFT --width 100 --height 30
 */

import { Rainfall } from '../src/index.js';

const ticker = process.argv[2] || 'AAPL';
const isLine = process.argv.includes('--line');
const widthIdx = process.argv.indexOf('--width');
const heightIdx = process.argv.indexOf('--height');

const width = widthIdx > -1 ? parseInt(process.argv[widthIdx + 1]) : 80;
const height = heightIdx > -1 ? parseInt(process.argv[heightIdx + 1]) : 24;

async function main() {
  // Initialize the Rainfall client
  // Uses RAINFALL_API_KEY env var or you can pass apiKey directly
  const rainfall = new Rainfall({
    apiKey: process.env.RAINFALL_API_KEY as string
  });

  console.log(`Fetching data for ${ticker}...\n`);

  try {
    if (isLine) {
      // Render a line chart
      const chart = await rainfall.charts.finviz.line(ticker, {
        width,
        height,
        title: `${ticker} Close Price`,
      });
      console.log(chart);
    } else {
      // Render a candlestick chart (default)
      const chart = await rainfall.charts.finviz.candlestick(ticker, {
        width,
        height,
        title: `${ticker} Candlestick`,
      });
      console.log(chart);
    }

    // You can also get raw data
    // const candles = await rainfall.charts.finviz.get(ticker);
    // console.log(`Got ${candles.length} candles`);

    // Or use quick() to render directly
    // await rainfall.charts.finviz.quick(ticker);

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
