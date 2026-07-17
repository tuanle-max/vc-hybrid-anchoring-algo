import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import algosdk from 'algosdk';
import { deployApplication, updateStatusRootB6 } from '../src/b6_smart_contract';
import { anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const ITERATIONS = 10;

async function runComparison() {
  console.log("Starting Baseline Comparison: B2 (Decoupled Note) vs. B6 (Smart Contract) on Algorand Mainnet...");
  
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  console.log(`Issuer address: ${issuerAccount.addr.toString()}`);

  // -----------------------------------------------------------------
  // DEPLOY B6 CONTRACT
  // -----------------------------------------------------------------
  console.log("\nDeploying B6 Smart Contract to Mainnet...");
  const deployRes = await deployApplication(issuerAccount);
  console.log(`B6 Contract deployed successfully! App ID: ${deployRes.appId}`);
  console.log(`Deployment transaction ID: ${deployRes.txId}`);
  console.log(`Deployment cost: ${deployRes.feeCharged} microAlgos`);

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
    
    console.log(`   Completed in ${res.durationMs.toFixed(2)}ms (Fee: ${res.feeCharged} microAlgos)`);
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
    
    console.log(`   Completed in ${res.durationMs.toFixed(2)}ms (Fee: ${res.feeCharged} microAlgos)`);
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
    "Baseline,AverageLatencyMs,AverageFeeMicroAlgos,DeploymentFeeMicroAlgos",
    `B2,${avgB2Latency.toFixed(2)},${avgB2Fee.toFixed(2)},0`,
    `B6,${avgB6Latency.toFixed(2)},${avgB6Fee.toFixed(2)},${deployRes.feeCharged}`
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
});
