import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { issueCredential } from '../src/b0_centralized/issuer';
import { generateDIDKeyPair, signChallenge } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';
import { VerifiableCredential } from '../src/b2_vc_anchoring/types';

const ISSUER_MNEMONIC = "depth target toddler canyon chase can sort select sudden execute planet garbage champion weasel ritual okay scout lyrics syrup mystery regular vessel today able try";
const TOTAL_CREDS = 1000;
const REVOKE_COUNT = 300;

async function runRevocationTest() {
  console.log("\nStarting Revocation & Status Correctness Benchmark (FAR/FRR)...");
  
  // Initialize issuer
  const issuerAccount = algosdk.mnemonicToSecretKey(ISSUER_MNEMONIC);
  const issuerKeys = generateDIDKeyPair(); // Use DID keys for Issuer
  console.log(`Issuer address loaded: ${issuerAccount.addr.toString()}`);
  
  // Initialize registries and holders
  const registry = new StatusRegistry();
  const learnerDIDKeys: any[] = [];
  const credentials: VerifiableCredential[] = [];

  console.log(`Generating ${TOTAL_CREDS} off-chain did:key identities and Verifiable Credentials...`);
  const claims = { course: "Introduction to Cryptography" };
  
  for (let i = 0; i < TOTAL_CREDS; i++) {
    const learner = generateDIDKeyPair();
    learnerDIDKeys.push(learner);

    const vcId = `urn:uuid:revocation-check-${i}`;
    const vc = issueCredential(vcId, learner.did, claims, issuerKeys.did, issuerKeys.privateKeyPem) as VerifiableCredential;
    credentials.push(vc);
    
    // Register as valid
    registry.register(vcId);
  }

  // 1. Initial status root compute & anchor
  const initialRoot = registry.computeStatusRoot();
  console.log("Anchoring initial status root (all valid) to Algorand Mainnet...");
  const initialAnchor = await anchorStatusToMainnet(issuerAccount, initialRoot, 1);
  console.log(`Initial anchor submitted. Tx ID: ${initialAnchor.txId}`);

  // 2. Verify all 1,000 before revocation
  console.log("Phase 1: Verifying all 1,000 valid credentials...");
  const nonce = "session-challenge-nonce";
  let preRevocationSuccess = 0;
  let preRevocationFailure = 0;
  const initialStatusList = registry.getRecordsList();

  for (let i = 0; i < TOTAL_CREDS; i++) {
    const holderSig = signChallenge(nonce, learnerDIDKeys[i].privateKeyPem);
    const holderProof = { nonce, signature: holderSig };
    
    const verification = await verifyCredentialB2(
      credentials[i],
      holderProof,
      initialAnchor.txId,
      initialStatusList
    );

    if (verification.isValid) {
      preRevocationSuccess++;
    } else {
      preRevocationFailure++;
    }
  }
  console.log(`Phase 1 complete. Success: ${preRevocationSuccess}, Failure: ${preRevocationFailure}`);

  // 3. Revoke a subset (300 credentials)
  console.log(`Phase 2: Revoking ${REVOKE_COUNT} credentials...`);
  for (let i = 0; i < REVOKE_COUNT; i++) {
    registry.revoke(credentials[i].id);
  }

  // Compute new root and anchor
  const updatedRoot = registry.computeStatusRoot();
  console.log("Anchoring updated status root (with revocations) to Algorand Mainnet...");
  const updatedAnchor = await anchorStatusToMainnet(issuerAccount, updatedRoot, 2);
  console.log(`Updated anchor submitted. Tx ID: ${updatedAnchor.txId}`);

  // 4. Re-verify all 1,000 credentials against the new anchor
  console.log("Phase 3: Verifying post-revocation correctness...");
  let falseAcceptances = 0;
  let falseRejections = 0;
  let correctAcceptances = 0;
  let correctRejections = 0;
  const updatedStatusList = registry.getRecordsList();

  for (let i = 0; i < TOTAL_CREDS; i++) {
    const holderSig = signChallenge(nonce, learnerDIDKeys[i].privateKeyPem);
    const holderProof = { nonce, signature: holderSig };
    
    const verification = await verifyCredentialB2(
      credentials[i],
      holderProof,
      updatedAnchor.txId,
      updatedStatusList
    );

    const isRevoked = i < REVOKE_COUNT;

    if (verification.isValid) {
      if (isRevoked) {
        // A revoked credential was accepted -> False Acceptance
        falseAcceptances++;
      } else {
        correctAcceptances++;
      }
    } else {
      if (isRevoked) {
        correctRejections++;
      } else {
        // A valid credential was rejected -> False Rejection
        falseRejections++;
      }
    }
  }

  // Calculate FAR and FRR
  const far = (falseAcceptances / REVOKE_COUNT) * 100;
  const frr = (falseRejections / (TOTAL_CREDS - REVOKE_COUNT)) * 100;

  console.log(`\nResults:`);
  console.log(`- Correct Acceptances: ${correctAcceptances}/700`);
  console.log(`- Correct Rejections: ${correctRejections}/300`);
  console.log(`- False Acceptances: ${falseAcceptances}`);
  console.log(`- False Rejections: ${falseRejections}`);
  console.log(`- False Acceptance Rate (FAR): ${far.toFixed(2)}%`);
  console.log(`- False Rejection Rate (FRR): ${frr.toFixed(2)}%`);

  // Write results to CSV
  const csvRows = [
    "Metric,Value",
    `TotalAttempts,${TOTAL_CREDS}`,
    `RevokedCount,${REVOKE_COUNT}`,
    `FalseAcceptances,${falseAcceptances}`,
    `FalseRejections,${falseRejections}`,
    `FalseAcceptanceRatePercent,${far.toFixed(2)}`,
    `FalseRejectionRatePercent,${frr.toFixed(2)}`
  ];

  const logsDir = path.join(__dirname, '../data/mainnet_logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'far_frr_metrics.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Revocation correctness benchmark completed! Saved to ${csvPath}`);
}

runRevocationTest().catch((err) => {
  console.error("Revocation test failed with error:", err);
});
