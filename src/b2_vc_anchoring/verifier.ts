import * as crypto from 'crypto';
import { algodClient } from '../shared/algorand_client';
import { resolveDIDToPublicKey, verifyChallenge } from './did';
import { VerifiableCredential, HolderProof, AnchoredStatusNote } from './types';

export interface VerificationResultB2 {
  isValid: boolean;
  error?: string;
  epochVersion?: number;
  metrics?: {
    cryptoMs: number;
    networkMs: number;
    totalMs: number;
  };
}

export interface VerifyOptionsB2 {
  disableCache?: boolean;
}

/**
 * Computes a SHA-256 hash of a list of statuses for verifier verification.
 */
function computeStatusRootFromList(statusList: { id: string; status: 'valid' | 'revoked' }[]): string {
  const sorted = [...statusList].sort((a, b) => a.id.localeCompare(b.id));
  const serialized = sorted.map((item) => `${item.id}:${item.status}`).join(',');
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

// Simple in-memory cache to prevent duplicate network calls for the same transaction ID
const txNoteCache = new Map<string, Uint8Array | undefined>();

/**
 * End-to-end B2 Verifiable Credential Verifier with granular performance measurement support.
 */
export async function verifyCredentialB2(
  vc: VerifiableCredential,
  holderProof: HolderProof,
  anchoredRootTxId: string,
  statusList: { id: string; status: 'valid' | 'revoked' }[],
  options?: VerifyOptionsB2
): Promise<VerificationResultB2> {
  const startTotal = performance.now();
  let cryptoMs = 0;
  let networkMs = 0;

  try {
    const startCrypto1 = performance.now();
    // 1. Verify issuer signature on VC
    if (!vc.proof) {
      return { isValid: false, error: 'Credential has no proof structure.' };
    }
    const issuerPubKeyPem = resolveDIDToPublicKey(vc.issuer);
    const { proof, ...unsignedVc } = vc;
    const dataToVerify = Buffer.from(JSON.stringify(unsignedVc));
    const signatureBytes = Buffer.from(proof.proofValue, 'hex');

    const isIssuerSigValid = crypto.verify(
      null,
      dataToVerify,
      crypto.createPublicKey(issuerPubKeyPem),
      signatureBytes
    );
    if (!isIssuerSigValid) {
      return { isValid: false, error: 'Issuer cryptographic signature is invalid.' };
    }

    // 2. Verify holder binding proof
    const learnerPubKeyPem = resolveDIDToPublicKey(vc.credentialSubject.id);
    const isHolderProofValid = verifyChallenge(
      holderProof.nonce,
      holderProof.signature,
      learnerPubKeyPem
    );
    if (!isHolderProofValid) {
      return { isValid: false, error: 'Holder binding proof signature is invalid.' };
    }
    cryptoMs += performance.now() - startCrypto1;

    // 3. Retrieve anchored root from Algorand Mainnet (with local caching)
    const startNetwork = performance.now();
    let noteBytes: Uint8Array | undefined;
    
    const useCache = !(options?.disableCache);
    if (useCache && txNoteCache.has(anchoredRootTxId)) {
      noteBytes = txNoteCache.get(anchoredRootTxId);
    } else {
      const txInfo = await algodClient.pendingTransactionInformation(anchoredRootTxId).do();
      noteBytes = txInfo.txn?.txn?.note;
      if (useCache) {
        txNoteCache.set(anchoredRootTxId, noteBytes);
      }
    }
    networkMs = performance.now() - startNetwork;

    const startCrypto2 = performance.now();
    if (!noteBytes) {
      return { isValid: false, error: 'Anchored transaction has no note field.' };
    }

    // Decode note
    const noteString = new TextDecoder().decode(noteBytes);
    let noteData: AnchoredStatusNote;
    try {
      noteData = JSON.parse(noteString);
    } catch {
      return { isValid: false, error: 'Anchored transaction note is not valid JSON.' };
    }

    const { rootHash, epochVersion } = noteData;
    if (!rootHash || epochVersion === undefined) {
      return { isValid: false, error: 'Anchored transaction note is missing rootHash or epochVersion.' };
    }

    // 4. Validate status list integrity against anchored root hash
    const computedRoot = computeStatusRootFromList(statusList);
    if (computedRoot !== rootHash) {
      return {
        isValid: false,
        error: `Status list integrity check failed. Computed: ${computedRoot}, Anchored: ${rootHash}`,
      };
    }

    // 5. Check VC status in the status list
    const vcRecord = statusList.find((item) => item.id === vc.id);
    if (!vcRecord) {
      return { isValid: false, error: 'Credential ID not found in status list.' };
    }
    if (vcRecord.status !== 'valid') {
      return { isValid: false, error: `Credential is revoked in epoch ${epochVersion}.` };
    }
    cryptoMs += performance.now() - startCrypto2;

    const totalMs = performance.now() - startTotal;

    return {
      isValid: true,
      epochVersion,
      metrics: { cryptoMs, networkMs, totalMs }
    };
  } catch (err: any) {
    const totalMs = performance.now() - startTotal;
    return {
      isValid: false,
      error: err.message || 'An unknown error occurred during verification.',
      metrics: { cryptoMs, networkMs, totalMs }
    };
  }
}
