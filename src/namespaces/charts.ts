/**
 * Charts namespace for Rainfall SDK
 * Terminal-based chart rendering using termichart
 */

import { RainfallClient } from '../client.js';
import type { Charts } from '../types.js';

// Dynamic import for termichart (optional dependency)
let Chart: any = null;
try {
  // @ts-ignore - optional dependency
  Chart = require('termichart').Chart;
} catch {
  // termichart not installed - will use fallback
}

export interface FinvizCandle {
  Date: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

export interface FinvizResponse {
  numbers: FinvizCandle[];
}

export interface ChartRenderOptions {
  width?: number;
  height?: number;
  title?: string;
  theme?: 'default' | 'dracula' | 'catppuccin' | 'solarized' | 'nord' | 'gruvbox';
  showVolume?: boolean;
  overlay?: 'sma' | 'ema' | 'none';
  overlayPeriod?: number;
}

const DEFAULT_OPTIONS: ChartRenderOptions = {
  width: 80,
  height: 24,
  theme: 'default',
  showVolume: false,
  overlay: 'none',
  overlayPeriod: 20,
};

/**
 * Fetch finviz data from the Rainfall API
 */
async function fetchFinvizData(
  client: RainfallClient,
  ticker: string
): Promise<FinvizCandle[]> {
  const response = await client.apiFetch(`olympic/features/finviz/${ticker.toUpperCase()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch finviz data: ${response.status} ${response.statusText}`);
  }

  const data: FinvizResponse = ((await response.json()) ?? {numbers:[]}) as FinvizResponse;
  return data.numbers.filter(Boolean);
}

/**
 * Render a candlestick chart using termichart
 */
function renderCandlestickChart(
  candles: FinvizCandle[],
  ticker: string,
  options: ChartRenderOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!Chart) {
    // Fallback: simple ASCII chart
    return renderAsciiChart(candles, ticker, opts);
  }

  try {
    const chart = new Chart('candlestick');
    chart.size(opts.width, opts.height);
    chart.setTitle(`${ticker} - ${candles.length} candles`);

    // Add candles
    candles.forEach((candle, index) => {
      chart.addCandle({
        time: index,
        open: candle.Open,
        high: candle.High,
        low: candle.Low,
        close: candle.Close,
        volume: candle.Volume,
      });
    });

    // Add overlay if requested
    if (opts.overlay !== 'none' && opts.overlayPeriod) {
      if (opts.overlay === 'sma') {
        chart.addSma(opts.overlayPeriod);
      } else if (opts.overlay === 'ema') {
        chart.addEma(opts.overlayPeriod);
      }
    }

    // Render and return
    return chart.render();
  } catch (error) {
    // Fallback to ASCII if termichart fails
    return renderAsciiChart(candles, ticker, opts);
  }
}

/**
 * Render a line chart using termichart
 */
function renderLineChart(
  candles: FinvizCandle[],
  ticker: string,
  options: ChartRenderOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!Chart) {
    return renderAsciiChart(candles, ticker, opts);
  }

  try {
    const chart = new Chart('line');
    chart.size(opts.width, opts.height);
    chart.setTitle(`${ticker} - Close Price`);

    // Add close prices as line points
    candles.forEach((candle, index) => {
      chart.addPoint(index, candle.Close);
    });

    return chart.render();
  } catch (error) {
    return renderAsciiChart(candles, ticker, opts);
  }
}

/**
 * Fallback ASCII chart renderer
 */
function renderAsciiChart(
  candles: FinvizCandle[],
  ticker: string,
  options: ChartRenderOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const height = opts.height || 20;
  const width = opts.width || 60;

  if (candles.length === 0) {
    return `No data available for ${ticker}`;
  }

  // Calculate price range
  const closes = candles.map(c => c.Close);
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const priceRange = maxPrice - minPrice || 1;

  // Sample candles to fit width
  const step = Math.max(1, Math.floor(candles.length / width));
  const sampledCandles: FinvizCandle[] = [];
  for (let i = 0; i < candles.length; i += step) {
    sampledCandles.push(candles[i]);
  }

  // Build chart lines
  const lines: string[] = [];
  const chartHeight = height - 4; // Reserve space for title and axis

  // Title
  lines.push(`\x1b[1m${ticker}\x1b[0m - ${sampledCandles.length} candles`);
  lines.push(`Range: ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}`);
  lines.push('');

  // Chart area
  for (let row = chartHeight - 1; row >= 0; row--) {
    const threshold = minPrice + (row / chartHeight) * priceRange;
    let line = '';

    for (const candle of sampledCandles) {
      const prevCandle = sampledCandles[sampledCandles.indexOf(candle) - 1];
      const prevClose = prevCandle?.Close ?? candle.Close;

      if (candle.Close >= threshold) {
        // Green for up, red for down
        if (candle.Close >= prevClose) {
          line += '\x1b[32m●\x1b[0m'; // Green circle
        } else {
          line += '\x1b[31m●\x1b[0m'; // Red circle
        }
      } else {
        line += ' ';
      }
    }

    // Add price label on right side for top and bottom rows
    if (row === chartHeight - 1) {
      lines.push(line + ` ${maxPrice.toFixed(2)}`);
    } else if (row === 0) {
      lines.push(line + ` ${minPrice.toFixed(2)}`);
    } else {
      lines.push(line);
    }
  }

  // Date range
  const firstDate = new Date(candles[0].Date).toLocaleDateString();
  const lastDate = new Date(candles[candles.length - 1].Date).toLocaleDateString();
  lines.push('');
  lines.push(`${firstDate} ─${'─'.repeat(sampledCandles.length - 2)}─ ${lastDate}`);

  // Summary stats
  const startClose = candles[0].Close;
  const endClose = candles[candles.length - 1].Close;
  const change = ((endClose - startClose) / startClose) * 100;
  const changeColor = change >= 0 ? '\x1b[32m' : '\x1b[31m';

  lines.push('');
  lines.push(`Start: ${startClose.toFixed(2)} → End: ${endClose.toFixed(2)} (${changeColor}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\x1b[0m)`);

  return lines.join('\n');
}

/**
 * Create the Charts namespace client
 */
export function createCharts(client: RainfallClient): Charts.ChartsClient {
  return {
    finviz: {
      /**
       * Get raw finviz data for a ticker
       */
      async get(ticker: string): Promise<FinvizCandle[]> {
        return fetchFinvizData(client, ticker);
      },

      /**
       * Render a candlestick chart for a ticker
       */
      async candlestick(ticker: string, options?: ChartRenderOptions): Promise<string> {
        const candles = await fetchFinvizData(client, ticker);
        return renderCandlestickChart(candles, ticker, options || {});
      },

      /**
       * Render a line chart for a ticker
       */
      async line(ticker: string, options?: ChartRenderOptions): Promise<string> {
        const candles = await fetchFinvizData(client, ticker);
        return renderLineChart(candles, ticker, options || {});
      },

      /**
       * Quick chart - renders and prints to console
       */
      async quick(ticker: string, options?: ChartRenderOptions): Promise<void> {
        const candles = await fetchFinvizData(client, ticker);
        const chart = renderCandlestickChart(candles, ticker, options || {});
        console.log(chart);
      },
    },

    /**
     * General chart rendering from custom data
     */
    render: {
      /**
       * Render a candlestick chart from custom data
       */
      candlestick(data: Array<{ open: number; high: number; low: number; close: number; volume?: number }>, title?: string, options?: ChartRenderOptions): string {
        const candles: FinvizCandle[] = data.map((d, i) => ({
          Date: new Date().toISOString(),
          Open: d.open,
          High: d.high,
          Low: d.low,
          Close: d.close,
          Volume: d.volume || 0,
        }));
        return renderCandlestickChart(candles, title || 'Chart', options || {});
      },

      /**
       * Render a line chart from custom data
       */
      line(data: Array<{ x: number; y: number }>, title?: string, options?: ChartRenderOptions): string {
        const opts = { ...DEFAULT_OPTIONS, ...options };

        if (!Chart) {
          // Simple ASCII line chart fallback
          return renderSimpleLineChart(data, title || 'Chart', opts);
        }

        try {
          const chart = new Chart('line');
          chart.size(opts.width, opts.height);
          chart.setTitle(title || 'Line Chart');

          data.forEach(point => {
            chart.addPoint(point.x, point.y);
          });

          return chart.render();
        } catch {
          return renderSimpleLineChart(data, title || 'Chart', opts);
        }
      },
    },
  };
}

/**
 * Simple ASCII line chart for arbitrary data
 */
function renderSimpleLineChart(
  data: Array<{ x: number; y: number }>,
  title: string,
  options: ChartRenderOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const height = (opts.height || 20) - 4;
  const width = opts.width || 60;

  if (data.length === 0) {
    return `No data available for ${title}`;
  }

  const yValues = data.map(d => d.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const yRange = maxY - minY || 1;

  const lines: string[] = [];
  lines.push(`\x1b[1m${title}\x1b[0m`);
  lines.push(`Range: ${minY.toFixed(2)} - ${maxY.toFixed(2)}`);
  lines.push('');

  // Sample data to fit width
  const step = Math.max(1, Math.floor(data.length / width));
  const sampled = data.filter((_, i) => i % step === 0);

  // Build chart
  for (let row = height - 1; row >= 0; row--) {
    const threshold = minY + (row / height) * yRange;
    let line = '';

    for (const point of sampled) {
      if (point.y >= threshold) {
        line += '●';
      } else {
        line += ' ';
      }
    }

    if (row === height - 1) {
      lines.push(line + ` ${maxY.toFixed(2)}`);
    } else if (row === 0) {
      lines.push(line + ` ${minY.toFixed(2)}`);
    } else {
      lines.push(line);
    }
  }

  return lines.join('\n');
}
