import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { issueCredential } from '../src/b0_centralized/issuer';
import { generateDIDKeyPair, signChallenge } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';
import { VerifiableCredential } from '../src/b2_vc_anchoring/types';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const COHORT_SIZE = 500;
const BENCHMARK_SIZE = 1000;
const WARMUP_SIZE = 50;

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[], meanVal: number): number {
  if (arr.length <= 1) return 0;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function mulberry32(seed: number) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function bootstrapCI(rawValues: number[]): { low: number, high: number } {
  if (rawValues.length === 0) return { low: 0, high: 0 };
  const n = rawValues.length;
  const rng = mulberry32(42);
  const bootstrapMeans: number[] = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += rawValues[Math.floor(rng() * n)];
    }
    bootstrapMeans.push(sum / n);
  }
  bootstrapMeans.sort((a, b) => a - b);
  return {
    low: bootstrapMeans[249],
    high: bootstrapMeans[9749]
  };
}

async function runGranularBenchmark() {
  console.log(`Starting Granular Latency Benchmark on Algorand Mainnet...`);
  console.log(`Cohort size: ${COHORT_SIZE}, Measurements: ${BENCHMARK_SIZE}, Warmup: ${WARMUP_SIZE}`);
  
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  const issuerKeys = generateDIDKeyPair();

  const registry = new StatusRegistry();
  const credentials: VerifiableCredential[] = [];
  const holderDIDKeys: any[] = [];
  const holderProofs: { nonce: string; signature: string }[] = [];
  const nonce = "granular-benchmark-nonce-challenge";

  console.log(`Generating ${COHORT_SIZE} off-chain did:key credentials...`);
  for (let i = 0; i < COHORT_SIZE; i++) {
    const holder = generateDIDKeyPair();
    holderDIDKeys.push(holder);
    
    const vcId = `urn:uuid:granular-latency-vc-${i}`;
    const vc = issueCredential(
      vcId,
      holder.did,
      { index: i },
      issuerKeys.did,
      issuerKeys.privateKeyPem
    ) as VerifiableCredential;
    
    credentials.push(vc);
    registry.register(vcId);

    // Pre-generate holder proof
    const holderSig = signChallenge(nonce, holder.privateKeyPem);
    holderProofs.push({ nonce, signature: holderSig });
  }

  const rootHash = registry.computeStatusRoot();
  console.log("Anchoring status root to Mainnet...");
  const anchorRes = await anchorStatusToMainnet(issuerAccount, rootHash, 1);
  console.log(`Anchored status root. Tx ID: ${anchorRes.txId}`);

  const statusList = registry.getRecordsList();
  
  // RNG for sampling
  const samplingRng = mulberry32(12345);

  async function runBenchmarkPass(cacheEnabled: boolean) {
    const cacheStr = cacheEnabled ? "WARM CACHE" : "COLD CACHE";
    console.log(`\nStarting pass: ${cacheStr}`);

    // Warmup
    for (let i = 0; i < WARMUP_SIZE; i++) {
      const idx = Math.floor(samplingRng() * COHORT_SIZE);
      await verifyCredentialB2(
        credentials[idx],
        holderProofs[idx],
        anchorRes.txId,
        statusList,
        { disableCache: !cacheEnabled }
      );
    }
    console.log(`Warmup: ${WARMUP_SIZE} iterations completed (not measured)`);

    // Measurement
    const cryptoTimes: number[] = [];
    const networkTimes: number[] = [];
    const totalTimes: number[] = [];

    for (let i = 0; i < BENCHMARK_SIZE; i++) {
      const idx = Math.floor(samplingRng() * COHORT_SIZE);
      const res = await verifyCredentialB2(
        credentials[idx],
        holderProofs[idx],
        anchorRes.txId,
        statusList,
        { disableCache: !cacheEnabled }
      );

      if (res.metrics) {
        cryptoTimes.push(res.metrics.cryptoMs);
        networkTimes.push(res.metrics.networkMs);
        totalTimes.push(res.metrics.totalMs);
      }
    }

    const mCrypto = mean(cryptoTimes);
    const mNetwork = mean(networkTimes);
    const mTotal = mean(totalTimes);

    const sdCrypto = stdDev(cryptoTimes, mCrypto);
    const sdNetwork = stdDev(networkTimes, mNetwork);
    const sdTotal = stdDev(totalTimes, mTotal);

    const ciCrypto = bootstrapCI(cryptoTimes);
    const ciNetwork = bootstrapCI(networkTimes);
    const ciTotal = bootstrapCI(totalTimes);

    const p95Crypto = percentile(cryptoTimes, 95);
    const p95Network = percentile(networkTimes, 95);
    const p95Total = percentile(totalTimes, 95);

    const p99Crypto = percentile(cryptoTimes, 99);
    const p99Network = percentile(networkTimes, 99);
    const p99Total = percentile(totalTimes, 99);

    console.log(`\n=== ${cacheStr} (n=${BENCHMARK_SIZE}, N_cohort=${COHORT_SIZE}, ${WARMUP_SIZE} warmup) ===`);
    console.log(`T_crypto:  mean=${mCrypto.toFixed(2)}  sd=${sdCrypto.toFixed(2)}  ci=[${ciCrypto.low.toFixed(2)}, ${ciCrypto.high.toFixed(2)}]  p95=${p95Crypto.toFixed(2)}  p99=${p99Crypto.toFixed(2)}`);
    console.log(`T_network: mean=${mNetwork.toFixed(2)}  sd=${sdNetwork.toFixed(2)}  ci=[${ciNetwork.low.toFixed(2)}, ${ciNetwork.high.toFixed(2)}]  p95=${p95Network.toFixed(2)}  p99=${p99Network.toFixed(2)}`);
    console.log(`T_total:   mean=${mTotal.toFixed(2)}  sd=${sdTotal.toFixed(2)}  ci=[${ciTotal.low.toFixed(2)}, ${ciTotal.high.toFixed(2)}]  p95=${p95Total.toFixed(2)}  p99=${p99Total.toFixed(2)}`);

    const csvRows = [
      "Metric,MeanMs,SDMs,CI95_LowMs,CI95_HighMs,p95Ms,p99Ms",
      `T_crypto,${mCrypto.toFixed(2)},${sdCrypto.toFixed(2)},${ciCrypto.low.toFixed(2)},${ciCrypto.high.toFixed(2)},${p95Crypto.toFixed(2)},${p99Crypto.toFixed(2)}`,
      `T_network,${mNetwork.toFixed(2)},${sdNetwork.toFixed(2)},${ciNetwork.low.toFixed(2)},${ciNetwork.high.toFixed(2)},${p95Network.toFixed(2)},${p99Network.toFixed(2)}`,
      `T_total,${mTotal.toFixed(2)},${sdTotal.toFixed(2)},${ciTotal.low.toFixed(2)},${ciTotal.high.toFixed(2)},${p95Total.toFixed(2)},${p99Total.toFixed(2)}`
    ];

    const logsDir = path.join(__dirname, '../data/mainnet_logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const filename = cacheEnabled ? 'granular_latency_warm.csv' : 'granular_latency_cold.csv';
    const csvPath = path.join(logsDir, filename);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`Saved results to ${csvPath}`);
  }

  // Run A: txNoteCache ENABLED (warm-cache)
  await runBenchmarkPass(true);

  // Run B: txNoteCache DISABLED (cold-cache)
  await runBenchmarkPass(false);
}

runGranularBenchmark().catch((err) => {
  console.error("Granular latency benchmark failed:", err);
});
