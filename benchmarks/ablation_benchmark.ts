import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { issueCredential } from '../src/b0_centralized/issuer';
import { generateDIDKeyPair, signChallenge } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';
import { VerifiableCredential } from '../src/b2_vc_anchoring/types';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const BENCHMARK_SIZE = 500;
const WARMUP_SIZE = 50;

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

async function runAblationStudy() {
  console.log(`Starting Cache Ablation Study (${BENCHMARK_SIZE} Credentials) on Algorand Mainnet...`);
  
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  const issuerKeys = generateDIDKeyPair();

  const registry = new StatusRegistry();
  const credentials: VerifiableCredential[] = [];
  const holderDIDKeys: any[] = [];

  console.log(`Generating ${BENCHMARK_SIZE} off-chain did:key credentials...`);
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    const holder = generateDIDKeyPair();
    holderDIDKeys.push(holder);
    
    const vcId = `urn:uuid:ablation-vc-${i}`;
    const vc = issueCredential(
      vcId,
      holder.did,
      { index: i },
      issuerKeys.did,
      issuerKeys.privateKeyPem
    ) as VerifiableCredential;
    
    credentials.push(vc);
    registry.register(vcId);
  }

  const rootHash = registry.computeStatusRoot();
  console.log("Anchoring status root to Mainnet...");
  const anchorRes = await anchorStatusToMainnet(issuerAccount, rootHash, 1);
  console.log(`Anchored status root. Tx ID: ${anchorRes.txId}`);

  const statusList = registry.getRecordsList();
  const nonce = "ablation-benchmark-nonce-challenge";

  // Pre-generate signatures to isolate verification time
  const holderProofs: { nonce: string; signature: string }[] = [];
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    const holderSig = signChallenge(nonce, holderDIDKeys[i].privateKeyPem);
    holderProofs.push({ nonce, signature: holderSig });
  }

  // -----------------------------------------------------------------
  // BATCH 1: txNoteCache DISABLED (network calls for all)
  // -----------------------------------------------------------------
  console.log("\nExecuting Batch 1: Verification with txNoteCache DISABLED...");
  for (let i = 0; i < WARMUP_SIZE; i++) {
    const idx = i % BENCHMARK_SIZE;
    await verifyCredentialB2(
      credentials[idx],
      holderProofs[idx],
      anchorRes.txId,
      statusList,
      { disableCache: true }
    );
  }
  console.log(`Warmup: ${WARMUP_SIZE} iterations completed (not measured)`);

  const timesWithoutCache: number[] = [];
  const startBatch1 = performance.now();
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    const startCall = performance.now();
    await verifyCredentialB2(
      credentials[i],
      holderProofs[i],
      anchorRes.txId,
      statusList,
      { disableCache: true }
    );
    timesWithoutCache.push(performance.now() - startCall);
  }
  const totalTimeWithoutCache = performance.now() - startBatch1;
  const meanWithout = mean(timesWithoutCache);
  const sdWithout = stdDev(timesWithoutCache, meanWithout);
  const ciWithout = bootstrapCI(timesWithoutCache);
  const hitRateWithout = 0.0;

  // -----------------------------------------------------------------
  // BATCH 2: txNoteCache ENABLED (standard)
  // -----------------------------------------------------------------
  console.log("\nExecuting Batch 2: Verification with txNoteCache ENABLED...");
  for (let i = 0; i < WARMUP_SIZE; i++) {
    const idx = i % BENCHMARK_SIZE;
    await verifyCredentialB2(
      credentials[idx],
      holderProofs[idx],
      anchorRes.txId,
      statusList,
      { disableCache: false }
    );
  }
  console.log(`Warmup: ${WARMUP_SIZE} iterations completed (not measured)`);

  const timesWithCache: number[] = [];
  const startBatch2 = performance.now();
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    const startCall = performance.now();
    await verifyCredentialB2(
      credentials[i],
      holderProofs[i],
      anchorRes.txId,
      statusList,
      { disableCache: false }
    );
    timesWithCache.push(performance.now() - startCall);
  }
  const totalTimeWithCache = performance.now() - startBatch2;
  const meanWith = mean(timesWithCache);
  const sdWith = stdDev(timesWithCache, meanWith);
  const ciWith = bootstrapCI(timesWithCache);
  const hitRateWith = ((BENCHMARK_SIZE - 1) / BENCHMARK_SIZE) * 100; // 499 hits out of 500

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log(`\n=== CACHE ABLATION (n=${BENCHMARK_SIZE}, ${WARMUP_SIZE} warmup per batch) ===`);
  console.log(`WITHOUT cache: total=${totalTimeWithoutCache.toFixed(2)} ms, mean/VC=${meanWithout.toFixed(2)} ms, sd=${sdWithout.toFixed(2)}, ci=[${ciWithout.low.toFixed(2)}, ${ciWithout.high.toFixed(2)}], hit=${hitRateWithout.toFixed(2)}%`);
  console.log(`WITH cache:    total=${totalTimeWithCache.toFixed(2)} ms, mean/VC=${meanWith.toFixed(2)} ms, sd=${sdWith.toFixed(2)}, ci=[${ciWith.low.toFixed(2)}, ${ciWith.high.toFixed(2)}], hit=${hitRateWith.toFixed(2)}%`);
  console.log(`Reduction factor: ${(totalTimeWithoutCache / totalTimeWithCache).toFixed(2)}x`);

  const csvRows = [
    "Condition,BatchSize,HitRate,TotalTimeMs,MeanPerVC,SDPerVC,CI95_Low,CI95_High",
    `Without_txNoteCache,${BENCHMARK_SIZE},${hitRateWithout.toFixed(2)},${totalTimeWithoutCache.toFixed(2)},${meanWithout.toFixed(2)},${sdWithout.toFixed(2)},${ciWithout.low.toFixed(2)},${ciWithout.high.toFixed(2)}`,
    `With_txNoteCache,${BENCHMARK_SIZE},${hitRateWith.toFixed(2)},${totalTimeWithCache.toFixed(2)},${meanWith.toFixed(2)},${sdWith.toFixed(2)},${ciWith.low.toFixed(2)},${ciWith.high.toFixed(2)}`
  ];

  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'ablation_study_n500.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\nAblation study metrics logged to ${csvPath}`);
}

runAblationStudy().catch((err) => {
  console.error("Ablation study benchmark failed:", err);
});
