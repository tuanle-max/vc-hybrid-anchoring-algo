import * as crypto from 'crypto';
import { VerifiableCredential } from './types';
import { statusRegistry } from './issuer';
import { measureLatencySync } from '../shared/latency';

export interface VerificationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Core function to verify a credential.
 * Verifies signature, structure, and database (status map) status.
 */
export function verifyCredential(
  vc: VerifiableCredential,
  publicKeyPem: string
): VerificationResult {
  try {
    if (!vc.proof) {
      return { isValid: false, error: "Credential has no proof structure." };
    }

    // 1. Check in-memory registry status
    const status = statusRegistry.get(vc.id);
    if (!status) {
      return { isValid: false, error: "Credential ID not found in registry." };
    }
    if (status !== 'valid') {
      return { isValid: false, error: `Credential is revoked (status: ${status}).` };
    }

    // 2. Prepare credential data without proof for signature verification
    const { proof, ...unsignedVc } = vc;
    const dataToVerify = Buffer.from(JSON.stringify(unsignedVc));

    // 3. Verify signature
    const publicKey = crypto.createPublicKey(publicKeyPem);
    const signatureBytes = Buffer.from(proof.proofValue, 'hex');

    const isSignatureValid = crypto.verify(null, dataToVerify, publicKey, signatureBytes);
    if (!isSignatureValid) {
      return { isValid: false, error: "Cryptographic signature is invalid." };
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, error: err.message || "An unknown verification error occurred." };
  }
}

/**
 * Latency-measured wrapper for credential verification.
 */
export function verifyCredentialWithLatency(
  vc: VerifiableCredential,
  publicKeyPem: string
): { durationMs: number; result: VerificationResult } {
  return measureLatencySync(() => verifyCredential(vc, publicKeyPem));
}
