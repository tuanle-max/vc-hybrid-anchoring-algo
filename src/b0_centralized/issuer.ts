import * as crypto from 'crypto';
import { VerifiableCredential, VCProof } from './types';
import { measureLatencySync } from '../shared/latency';

// In-memory database representing the status verifier's registry
export const statusRegistry = new Map<string, 'valid' | 'revoked'>();

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generates an Ed25519 keypair for standard cryptographic signing.
 */
export function generateIssuerKeys(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/**
 * Core function to issue and sign a mock W3C Verifiable Credential.
 * Saves the VC ID to the in-memory registry.
 */
export function issueCredential(
  id: string,
  subjectId: string,
  claims: Record<string, any>,
  issuerDid: string,
  privateKeyPem: string
): VerifiableCredential {
  const issuanceDate = new Date().toISOString();
  
  const credential: Omit<VerifiableCredential, 'proof'> = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://www.w3.org/2018/credentials/examples/v1"
    ],
    id,
    type: ["VerifiableCredential", "CentralizedOwnershipCredential"],
    issuer: issuerDid,
    issuanceDate,
    credentialSubject: {
      id: subjectId,
      ...claims,
    },
  };

  // Sign canonical JSON string of the credential structure
  const dataToSign = Buffer.from(JSON.stringify(credential));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, dataToSign, privateKey);

  const proof: VCProof = {
    type: "Ed25519Signature2020",
    created: issuanceDate,
    verificationMethod: `${issuerDid}#key-1`,
    proofPurpose: "assertionMethod",
    proofValue: signature.toString('hex'),
  };

  const signedVc: VerifiableCredential = {
    ...credential,
    proof,
  };

  // Register in-memory database status
  statusRegistry.set(id, 'valid');

  return signedVc;
}

/**
 * Latency-measured wrapper for credential issuance.
 */
export function issueCredentialWithLatency(
  id: string,
  subjectId: string,
  claims: Record<string, any>,
  issuerDid: string,
  privateKeyPem: string
): { durationMs: number; result: VerifiableCredential } {
  return measureLatencySync(() => 
    issueCredential(id, subjectId, claims, issuerDid, privateKeyPem)
  );
}

/**
 * Revokes a credential by updating the in-memory status registry.
 */
export function revokeCredential(id: string): void {
  if (statusRegistry.has(id)) {
    statusRegistry.set(id, 'revoked');
  } else {
    throw new Error(`Credential with ID ${id} not found in registry.`);
  }
}
