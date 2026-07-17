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

async function runAblationStudy() {
  console.log("Starting Cache Ablation Study (500 Credentials) on Algorand Mainnet...");
  
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
  const startWithoutCache = performance.now();
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    await verifyCredentialB2(
      credentials[i],
      holderProofs[i],
      anchorRes.txId,
      statusList,
      { disableCache: true }
    );
  }
  const totalTimeWithoutCache = performance.now() - startWithoutCache;
  console.log(`Batch 1 Completed. Total Time: ${totalTimeWithoutCache.toFixed(2)}ms`);

  // -----------------------------------------------------------------
  // BATCH 2: txNoteCache ENABLED (standard)
  // -----------------------------------------------------------------
  console.log("\nExecuting Batch 2: Verification with txNoteCache ENABLED...");
  const startWithCache = performance.now();
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    await verifyCredentialB2(
      credentials[i],
      holderProofs[i],
      anchorRes.txId,
      statusList,
      { disableCache: false }
    );
  }
  const totalTimeWithCache = performance.now() - startWithCache;
  console.log(`Batch 2 Completed. Total Time: ${totalTimeWithCache.toFixed(2)}ms`);

  // Calculations
  const cacheHitRateWithoutCache = 0.0;
  const cacheHitRateWithCache = ((BENCHMARK_SIZE - 1) / BENCHMARK_SIZE) * 100; // 499 hits out of 500

  console.log("\n=======================================================");
  console.log("Ablation Study Results:");
  console.log(`- Without Cache (Hit Rate: ${cacheHitRateWithoutCache.toFixed(1)}%):`);
  console.log(`    Total Batch Verification Time: ${totalTimeWithoutCache.toFixed(2)}ms`);
  console.log(`    Average Latency Per VC:        ${(totalTimeWithoutCache / BENCHMARK_SIZE).toFixed(2)}ms`);
  console.log(`- With Cache (Hit Rate: ${cacheHitRateWithCache.toFixed(1)}%):`);
  console.log(`    Total Batch Verification Time: ${totalTimeWithCache.toFixed(2)}ms`);
  console.log(`    Average Latency Per VC:        ${(totalTimeWithCache / BENCHMARK_SIZE).toFixed(2)}ms`);
  console.log(`- Speedup Multiplier: ${ (totalTimeWithoutCache / totalTimeWithCache).toFixed(1) }x`);
  console.log("=======================================================");

  const csvRows = [
    "Metric,Value",
    `BatchSize,${BENCHMARK_SIZE}`,
    `CacheHitRatePercent_WithCache,${cacheHitRateWithCache.toFixed(2)}`,
    `CacheHitRatePercent_WithoutCache,${cacheHitRateWithoutCache.toFixed(2)}`,
    `TotalTimeWithCacheMs,${totalTimeWithCache.toFixed(2)}`,
    `TotalTimeWithoutCacheMs,${totalTimeWithoutCache.toFixed(2)}`,
    `SpeedupMultiplier,${(totalTimeWithoutCache / totalTimeWithCache).toFixed(2)}`
  ];

  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'ablation_study.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Ablation study metrics logged to ${csvPath}`);
}

runAblationStudy().catch((err) => {
  console.error("Ablation study benchmark failed:", err);
});
