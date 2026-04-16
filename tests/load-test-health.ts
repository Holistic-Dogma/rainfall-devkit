#!/usr/bin/env bun
/**
 * Load test: 5 parallel agents hitting /health endpoint
 * 
 * Tests:
 * 1. Concurrent health checks (5 parallel)
 * 2. Response time under load
 * 3. Edge metrics presence and validity
 * 4. Sustained load (10 rounds)
 */

const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost:8787/health';
const PARALLEL_AGENTS = 5;
const ROUNDS = 10;

interface HealthResponse {
  status: string;
  daemon: string;
  version: string;
  tools_loaded: number;
  local_functions: string[];
  mcp_clients: number;
  mcp_tools: number;
  edge_node_id?: string;
  clients_connected: number;
  edge_metrics: {
    heartbeatLatencyMs: number;
    avgHeartbeatLatencyMs: number;
    queueDepth: number;
    totalJobsClaimed: number;
    totalJobsCompleted: number;
    totalJobsFailed: number;
    lastHeartbeatAt: string | null;
    lastJobClaimedAt: string | null;
  } | null;
}

interface TestResult {
  agent: number;
  round: number;
  latencyMs: number;
  status: number;
  hasMetrics: boolean;
  queueDepth: number;
  error?: string;
}

async function hitHealth(agentId: number, round: number): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    const body: HealthResponse = await res.json();

    return {
      agent: agentId,
      round,
      latencyMs,
      status: res.status,
      hasMetrics: body.edge_metrics !== null && body.edge_metrics !== undefined,
      queueDepth: body.edge_metrics?.queueDepth ?? -1,
    };
  } catch (err) {
    return {
      agent: agentId,
      round,
      latencyMs: Date.now() - start,
      status: 0,
      hasMetrics: false,
      queueDepth: -1,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runLoadTest() {
  console.log(`\n🔥 Load Test: ${PARALLEL_AGENTS} parallel agents × ${ROUNDS} rounds`);
  console.log(`   Target: ${HEALTH_URL}\n`);

  const allResults: TestResult[] = [];
  const startTime = Date.now();

  for (let round = 0; round < ROUNDS; round++) {
    // Fire all agents in parallel
    const promises = Array.from({ length: PARALLEL_AGENTS }, (_, i) =>
      hitHealth(i + 1, round + 1)
    );
    const results = await Promise.all(promises);
    allResults.push(...results);

    const roundLatencies = results.map(r => r.latencyMs);
    const avg = Math.round(roundLatencies.reduce((a, b) => a + b, 0) / roundLatencies.length);
    const max = Math.max(...roundLatencies);
    const errors = results.filter(r => r.error).length;

    console.log(
      `  Round ${String(round + 1).padStart(2)}: avg=${String(avg).padStart(4)}ms  max=${String(max).padStart(4)}ms  errors=${errors}`
    );

    // Small delay between rounds
    await new Promise(r => setTimeout(r, 200));
  }

  const totalTime = Date.now() - startTime;
  const successful = allResults.filter(r => r.status === 200);
  const failed = allResults.filter(r => r.status !== 200);
  const withMetrics = allResults.filter(r => r.hasMetrics);

  console.log(`\n📊 Results Summary`);
  console.log(`   Total requests:  ${allResults.length}`);
  console.log(`   Successful:      ${successful.length}`);
  console.log(`   Failed:          ${failed.length}`);
  console.log(`   With metrics:    ${withMetrics.length}`);
  console.log(`   Total time:      ${totalTime}ms`);

  if (successful.length > 0) {
    const latencies = successful.map(r => r.latencyMs);
    console.log(`   Latency min:     ${Math.min(...latencies)}ms`);
    console.log(`   Latency avg:     ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`);
    console.log(`   Latency max:     ${Math.max(...latencies)}ms`);
    console.log(`   Latency p95:     ${latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)]}ms`);
  }

  if (withMetrics.length > 0) {
    const depths = withMetrics.map(r => r.queueDepth);
    console.log(`   Queue depth range: ${Math.min(...depths)} - ${Math.max(...depths)}`);
  }

  // Print last health response for inspection
  if (successful.length > 0) {
    const last = successful[successful.length - 1];
    console.log(`\n🔍 Last successful response:`);
    console.log(`   Agent ${last.agent}, Round ${last.round}`);
    console.log(`   Has edge_metrics: ${last.hasMetrics}`);
    console.log(`   Queue depth: ${last.queueDepth}`);
  }

  // Exit code
  if (failed.length > 0) {
    console.log(`\n❌ ${failed.length} requests failed`);
    for (const f of failed.slice(0, 3)) {
      console.log(`   Agent ${f.agent}, Round ${f.round}: ${f.error || `HTTP ${f.status}`}`);
    }
    process.exit(1);
  } else {
    console.log(`\n✅ All ${allResults.length} requests succeeded`);
  }
}

runLoadTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
