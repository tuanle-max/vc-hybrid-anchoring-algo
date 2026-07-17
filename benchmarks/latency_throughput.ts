import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { algodClient } from '../src/shared/algorand_client';
import { generateIssuerKeys, issueCredentialWithLatency } from '../src/b0_centralized/issuer';
import { verifyCredentialWithLatency } from '../src/b0_centralized/verifier';
import { issueCredentialB1, verifyCredentialB1 } from '../src/b1_token_ownership';
import { generateDIDKeyPair, signChallenge } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const COHORTS = [25, 50, 100, 250, 500];

async function fundAccount(sender: algosdk.Account, receiverAddress: string, amountMicroAlgos: number) {
  const suggestedParams = await algodClient.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: sender.addr.toString(),
    receiver: receiverAddress,
    amount: amountMicroAlgos,
    suggestedParams,
  });
  const signed = txn.signTxn(sender.sk);
  const { txid } = await algodClient.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algodClient, txid, 4);
}

async function runBenchmark() {
  console.log("Starting Cohort Latency Benchmarks on Algorand Mainnet...");
  
  // Initialize issuer account
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  console.log(`Issuer address loaded: ${issuerAccount.addr.toString()}`);

  const csvRows: string[] = [
    "CohortSize,Baseline,TotalIssuanceTimeMs,AverageIssuanceTimeMs,TotalVerificationTimeMs,AverageVerificationTimeMs,TotalFeesMicroAlgos"
  ];

  // -----------------------------------------------------------------
  // MEASURE B1 BASELINE SAMPLE FOR EXTRAPOLATION
  // -----------------------------------------------------------------
  console.log("\nRunning a single B1 credential flow on Mainnet for empirical extrapolation...");
  const tempLearner = algosdk.generateAccount();
  console.log(`Temp learner generated: ${tempLearner.addr.toString()}`);
  
  console.log("Funding temp learner account with 300,000 microalgos for opt-in...");
  await fundAccount(issuerAccount, tempLearner.addr.toString(), 300000);
  
  console.log("Executing B1 issuance transaction flow...");
  const b1IssueRes = await issueCredentialB1(issuerAccount, tempLearner);
  console.log(`B1 Issuance finished. Asset ID: ${b1IssueRes.assetId}, Latency: ${b1IssueRes.durationMs.toFixed(2)}ms, Fee: ${b1IssueRes.totalFeesMicroAlgos} microAlgos`);

  console.log("Executing B1 verification transaction flow...");
  const b1VerifyRes = await verifyCredentialB1(tempLearner.addr.toString(), b1IssueRes.assetId);
  console.log(`B1 Verification finished. Latency: ${b1VerifyRes.durationMs.toFixed(2)}ms`);

  const b1SampleIssueLatency = b1IssueRes.durationMs;
  const b1SampleVerifyLatency = b1VerifyRes.durationMs;
  const b1SampleFees = b1IssueRes.totalFeesMicroAlgos;

  // -----------------------------------------------------------------
  // RUN COHORTS
  // -----------------------------------------------------------------
  for (const N of COHORTS) {
    console.log(`\n======================================`);
    console.log(`Processing Cohort Size: N = ${N}`);
    console.log(`======================================`);

    // -----------------------------------------------------------------
    // B0 (Centralized) Benchmarking
    // -----------------------------------------------------------------
    console.log(`Running B0 (Centralized) for N = ${N}...`);
    const b0Keys = generateIssuerKeys();
    const b0IssuerDid = 'did:key:issuer';
    const b0SubjectId = 'did:key:learner';
    const b0Claims = { name: "Alice" };

    const b0IssueStart = performance.now();
    const b0Vcs: any[] = [];
    for (let i = 0; i < N; i++) {
      const vc = issueCredentialWithLatency(`urn:uuid:${i}`, b0SubjectId, b0Claims, b0IssuerDid, b0Keys.privateKey);
      b0Vcs.push(vc.result);
    }
    const b0IssueDuration = performance.now() - b0IssueStart;

    const b0VerifyStart = performance.now();
    for (let i = 0; i < N; i++) {
      verifyCredentialWithLatency(b0Vcs[i], b0Keys.publicKey);
    }
    const b0VerifyDuration = performance.now() - b0VerifyStart;

    csvRows.push(`${N},B0,${b0IssueDuration.toFixed(2)},${(b0IssueDuration / N).toFixed(2)},${b0VerifyDuration.toFixed(2)},${(b0VerifyDuration / N).toFixed(2)},0`);

    // -----------------------------------------------------------------
    // B1 (Legacy Token) Benchmarking (Extrapolated)
    // -----------------------------------------------------------------
    console.log(`Extrapolating B1 (Legacy Token) for N = ${N}...`);
    const b1TotalIssueTime = b1SampleIssueLatency * N;
    const b1TotalVerifyTime = b1SampleVerifyLatency * N;
    const b1TotalFees = b1SampleFees * N;

    csvRows.push(`${N},B1,${b1TotalIssueTime.toFixed(2)},${b1SampleIssueLatency.toFixed(2)},${b1TotalVerifyTime.toFixed(2)},${b1SampleVerifyLatency.toFixed(2)},${b1TotalFees}`);

    // -----------------------------------------------------------------
    // B2 (Proposed Decoupled) Benchmarking
    // -----------------------------------------------------------------
    console.log(`Running B2 (Proposed Decoupled) for N = ${N}...`);
    const b2IssuerKeys = generateDIDKeyPair();
    const b2Learners = Array.from({ length: N }, () => generateDIDKeyPair());
    const b2Claims = { name: "Alice" };

    // 1. Generate N VCs off-chain
    const b2IssueStart = performance.now();
    const registry = new StatusRegistry();
    const b2VcsList: any[] = [];
    
    for (let i = 0; i < N; i++) {
      const vcId = `urn:uuid:b2-${N}-${i}`;
      const vc = issueCredentialWithLatency(vcId, b2Learners[i].did, b2Claims, b2IssuerKeys.did, b2IssuerKeys.privateKeyPem);
      b2VcsList.push(vc.result);
      registry.register(vcId);
    }

    // 2. Compute status root and anchor
    const rootHash = registry.computeStatusRoot();
    console.log(`Anchoring status root for cohort N = ${N} to Mainnet...`);
    const anchorResult = await anchorStatusToMainnet(issuerAccount, rootHash, N);
    const b2IssueDuration = (performance.now() - b2IssueStart) + anchorResult.durationMs;

    // 3. Verify N VCs
    const b2VerifyStart = performance.now();
    const statusList = registry.getRecordsList();
    const nonce = "cohort-verifier-nonce";

    for (let i = 0; i < N; i++) {
      const holderSig = signChallenge(nonce, b2Learners[i].privateKeyPem);
      const holderProof = { nonce, signature: holderSig };
      await verifyCredentialB2(b2VcsList[i], holderProof, anchorResult.txId, statusList);
    }
    const b2VerifyDuration = performance.now() - b2VerifyStart;

    csvRows.push(`${N},B2,${b2IssueDuration.toFixed(2)},${(b2IssueDuration / N).toFixed(2)},${b2VerifyDuration.toFixed(2)},${(b2VerifyDuration / N).toFixed(2)},${anchorResult.feeCharged}`);
  }

  // -----------------------------------------------------------------
  // WRITE CSV
  // -----------------------------------------------------------------
  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'latency_metrics.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\nLatency and Throughput Benchmark completed! Saved to ${csvPath}`);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed with error:", err);
});
