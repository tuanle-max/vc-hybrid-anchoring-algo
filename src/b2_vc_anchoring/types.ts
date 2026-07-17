import { VerifiableCredential as BaseVC, VCProof } from '../b0_centralized/types';

export { VCProof };

export interface VerifiableCredential extends BaseVC {
  // We can share the exact same format
}

export interface HolderProof {
  nonce: string;
  signature: string;
}

export interface AnchoredStatusNote {
  rootHash: string;
  epochVersion: number;
}
