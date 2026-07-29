import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import algosdk from 'algosdk';
import { deployApplication, updateStatusRootB6 } from '../src/b6_smart_contract';
import { anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const ITERATIONS = 10;

interface TxRecord {
  baseline: string;
  txid: string;
  confirmed_round: number;
  fee_microalgos: number;
  conf_ms: number;
}

async function runComparison() {
  console.log("Starting Baseline Comparison: B2 (Decoupled Note) vs. B6 (Smart Contract) on Algorand Mainnet...");
  
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  console.log(`Issuer address: ${issuerAccount.addr.toString()}`);

  const records: TxRecord[] = [];

  // -----------------------------------------------------------------
  // DEPLOY B6 CONTRACT
  // -----------------------------------------------------------------
  console.log("\nDeploying B6 Smart Contract to Mainnet...");
  const deployStart = performance.now();
  const deployRes = await deployApplication(issuerAccount);
  const deployEnd = performance.now();
  const deployDurationMs = deployEnd - deployStart;

  console.log(`B6 Contract deployed successfully! App ID: ${deployRes.appId}`);
  console.log(`Deployment transaction ID: ${deployRes.txId}`);
  console.log(`Deployment confirmed round: ${deployRes.confirmedRound}`);
  console.log(`Deployment cost: ${deployRes.feeCharged} microAlgos`);

  records.push({
    baseline: 'B6_DEPLOY',
    txid: deployRes.txId,
    confirmed_round: deployRes.confirmedRound,
    fee_microalgos: deployRes.feeCharged,
    conf_ms: Number(deployDurationMs.toFixed(2)),
  });

  // -----------------------------------------------------------------
  // RUN B6 BENCHMARK (10 App Calls)
  // -----------------------------------------------------------------
  console.log(`\nRunning ${ITERATIONS} iterations of B6 App Call updates...`);
  const b6Latencies: number[] = [];
  const b6Fees: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const mockRoot = crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
    console.log(`Iteration ${i + 1}/10: Updating status root in B6 state to ${mockRoot.substring(0, 8)}...`);
    
    const res = await updateStatusRootB6(issuerAccount, deployRes.appId, mockRoot);
    b6Latencies.push(res.durationMs);
    b6Fees.push(res.feeCharged);

    records.push({
      baseline: 'B6',
      txid: res.txId,
      confirmed_round: res.confirmedRound,
      fee_microalgos: res.feeCharged,
      conf_ms: Number(res.durationMs.toFixed(2)),
    });
    
    console.log(`   Completed in ${res.durationMs.toFixed(2)}ms (TxID: ${res.txId}, Round: ${res.confirmedRound}, Fee: ${res.feeCharged} microAlgos)`);
  }

  // -----------------------------------------------------------------
  // RUN B2 BENCHMARK (10 Payment note txs)
  // -----------------------------------------------------------------
  console.log(`\nRunning ${ITERATIONS} iterations of B2 Payment note updates...`);
  const b2Latencies: number[] = [];
  const b2Fees: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const mockRoot = crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
    console.log(`Iteration ${i + 1}/10: Anchoring root in B2 note field to ${mockRoot.substring(0, 8)}...`);
    
    const res = await anchorStatusToMainnet(issuerAccount, mockRoot, i + 1);
    b2Latencies.push(res.durationMs);
    b2Fees.push(res.feeCharged);

    records.push({
      baseline: 'B2',
      txid: res.txId,
      confirmed_round: res.confirmedRound,
      fee_microalgos: res.feeCharged,
      conf_ms: Number(res.durationMs.toFixed(2)),
    });
    
    console.log(`   Completed in ${res.durationMs.toFixed(2)}ms (TxID: ${res.txId}, Round: ${res.confirmedRound}, Fee: ${res.feeCharged} microAlgos)`);
  }

  // -----------------------------------------------------------------
  // CALCULATE STATISTICS & SAVE CSV
  // -----------------------------------------------------------------
  const avgB2Latency = b2Latencies.reduce((a, b) => a + b, 0) / ITERATIONS;
  const avgB2Fee = b2Fees.reduce((a, b) => a + b, 0) / ITERATIONS;

  const avgB6Latency = b6Latencies.reduce((a, b) => a + b, 0) / ITERATIONS;
  const avgB6Fee = b6Fees.reduce((a, b) => a + b, 0) / ITERATIONS;

  console.log("\n=============================================");
  console.log("Comparison Summary:");
  console.log(`- B2 (Decoupled Note) Average Latency: ${avgB2Latency.toFixed(2)}ms`);
  console.log(`- B2 (Decoupled Note) Average Fee:     ${avgB2Fee.toFixed(2)} microAlgos`);
  console.log(`- B6 (Smart Contract) Average Latency: ${avgB6Latency.toFixed(2)}ms`);
  console.log(`- B6 (Smart Contract) Average Fee:     ${avgB6Fee.toFixed(2)} microAlgos`);
  console.log("=============================================");

  const csvRows = [
    "Baseline,txid,confirmed_round,fee_microalgos,conf_ms",
    ...records.map(r => `${r.baseline},${r.txid},${r.confirmed_round},${r.fee_microalgos},${r.conf_ms}`)
  ];

  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'b6_vs_b2_metrics.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Comparison metrics saved to ${csvPath}`);
}

runComparison().catch((err) => {
  console.error("Comparison run failed with error:", err);
  process.exit(1);
});
