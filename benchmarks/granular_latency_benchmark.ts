import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { issueCredential } from '../src/b0_centralized/issuer';
import { generateDIDKeyPair, signChallenge } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';
import { VerifiableCredential } from '../src/b2_vc_anchoring/types';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const BENCHMARK_SIZE = 1000;

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

async function runGranularBenchmark() {
  console.log("Starting Granular Latency Benchmark (1000 Credentials) on Algorand Mainnet...");
  
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  const issuerKeys = generateDIDKeyPair();

  const registry = new StatusRegistry();
  const credentials: VerifiableCredential[] = [];
  const holderDIDKeys: any[] = [];

  console.log(`Generating ${BENCHMARK_SIZE} off-chain did:key credentials...`);
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
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
  }

  const rootHash = registry.computeStatusRoot();
  console.log("Anchoring status root to Mainnet...");
  const anchorRes = await anchorStatusToMainnet(issuerAccount, rootHash, 1);
  console.log(`Anchored status root. Tx ID: ${anchorRes.txId}`);

  const cryptoTimes: number[] = [];
  const networkTimes: number[] = [];
  const totalTimes: number[] = [];
  const statusList = registry.getRecordsList();
  const nonce = "granular-benchmark-nonce-challenge";

  console.log("Running verifications and collecting granular metrics...");
  for (let i = 0; i < BENCHMARK_SIZE; i++) {
    const holderSig = signChallenge(nonce, holderDIDKeys[i].privateKeyPem);
    const holderProof = { nonce, signature: holderSig };
    
    const res = await verifyCredentialB2(
      credentials[i],
      holderProof,
      anchorRes.txId,
      statusList
    );

    if (res.metrics) {
      cryptoTimes.push(res.metrics.cryptoMs);
      networkTimes.push(res.metrics.networkMs);
      totalTimes.push(res.metrics.totalMs);
    }
  }

  // Calculate statistics
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const stats = {
    crypto: {
      mean: mean(cryptoTimes),
      p95: percentile(cryptoTimes, 95),
      p99: percentile(cryptoTimes, 99),
    },
    network: {
      mean: mean(networkTimes),
      p95: percentile(networkTimes, 95),
      p99: percentile(networkTimes, 99),
    },
    total: {
      mean: mean(totalTimes),
      p95: percentile(totalTimes, 95),
      p99: percentile(totalTimes, 99),
    }
  };

  console.log("\n=======================================================");
  console.log("Granular Latency Metrics (1000 Credentials with Cache Enabled):");
  console.log(`- Crypto Latency (T_crypto):`);
  console.log(`    Mean: ${stats.crypto.mean.toFixed(2)}ms, p95: ${stats.crypto.p95.toFixed(2)}ms, p99: ${stats.crypto.p99.toFixed(2)}ms`);
  console.log(`- Network Latency (T_network):`);
  console.log(`    Mean: ${stats.network.mean.toFixed(2)}ms, p95: ${stats.network.p95.toFixed(2)}ms, p99: ${stats.network.p99.toFixed(2)}ms`);
  console.log(`- Total Latency (T_total):`);
  console.log(`    Mean: ${stats.total.mean.toFixed(2)}ms, p95: ${stats.total.p95.toFixed(2)}ms, p99: ${stats.total.p99.toFixed(2)}ms`);
  console.log("=======================================================");

  const csvRows = [
    "Metric,MeanMs,p95Ms,p99Ms",
    `T_crypto,${stats.crypto.mean.toFixed(2)},${stats.crypto.p95.toFixed(2)},${stats.crypto.p99.toFixed(2)}`,
    `T_network,${stats.network.mean.toFixed(2)},${stats.network.p95.toFixed(2)},${stats.network.p99.toFixed(2)}`,
    `T_total,${stats.total.mean.toFixed(2)},${stats.total.p95.toFixed(2)},${stats.total.p99.toFixed(2)}`
  ];

  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'granular_latency.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Granular latency metrics successfully logged to ${csvPath}`);
}

runGranularBenchmark().catch((err) => {
  console.error("Granular latency benchmark failed:", err);
});
