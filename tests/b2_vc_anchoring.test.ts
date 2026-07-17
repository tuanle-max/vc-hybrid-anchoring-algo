import algosdk from 'algosdk';
import * as crypto from 'crypto';
import { generateDIDKeyPair, signChallenge, verifyChallenge, resolveDIDToPublicKey } from '../src/b2_vc_anchoring/did';
import { StatusRegistry, anchorStatusToMainnet } from '../src/b2_vc_anchoring/status_registry';
import { verifyCredentialB2 } from '../src/b2_vc_anchoring/verifier';
import { issueCredential } from '../src/b0_centralized/issuer';
import { VerifiableCredential } from '../src/b2_vc_anchoring/types';
import { algodClient } from '../src/shared/algorand_client';

jest.mock('../src/shared/algorand_client', () => {
  const mockAlgodClient = {
    getTransactionParams: jest.fn(),
    sendRawTransaction: jest.fn(),
    pendingTransactionInformation: jest.fn(),
  };
  return {
    algodClient: mockAlgodClient,
  };
});

jest.mock('algosdk', () => {
  const originalAlgod = jest.requireActual('algosdk');
  return {
    ...originalAlgod,
    waitForConfirmation: jest.fn(),
  };
});

describe('Baseline 2: Decoupled Merkle Status Anchoring (B2)', () => {
  let issuerKeys: { did: string; publicKeyPem: string; privateKeyPem: string };
  let learnerKeys: { did: string; publicKeyPem: string; privateKeyPem: string };
  const mockTxId = 'anchored-txid-999';

  beforeAll(() => {
    issuerKeys = generateDIDKeyPair();
    learnerKeys = generateDIDKeyPair();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DID-Key and Challenge Logic', () => {
    test('should generate valid did:key and resolve it back to public PEM', () => {
      expect(issuerKeys.did).toContain('did:key:z');
      const resolvedPem = resolveDIDToPublicKey(issuerKeys.did);
      expect(resolvedPem).toBe(issuerKeys.publicKeyPem);
    });

    test('should sign a challenge and verify it successfully', () => {
      const nonce = 'random-nonce-12345';
      const sig = signChallenge(nonce, learnerKeys.privateKeyPem);
      const verified = verifyChallenge(nonce, sig, learnerKeys.did);
      expect(verified).toBe(true);
    });

    test('should fail challenge verification with wrong signature or public key', () => {
      const nonce = 'random-nonce-12345';
      const sig = signChallenge(nonce, learnerKeys.privateKeyPem);
      const verified = verifyChallenge(nonce, sig, issuerKeys.did); // wrong identity
      expect(verified).toBe(false);
    });
  });

  describe('Registry and Root Hashing', () => {
    test('should compute a deterministic hash root based on entries', () => {
      const registry1 = new StatusRegistry();
      const registry2 = new StatusRegistry();

      registry1.register('vc-1');
      registry1.register('vc-2');

      registry2.register('vc-2');
      registry2.register('vc-1');

      // Sorting ensures order independence
      expect(registry1.computeStatusRoot()).toBe(registry2.computeStatusRoot());

      registry1.revoke('vc-1');
      expect(registry1.computeStatusRoot()).not.toBe(registry2.computeStatusRoot());
    });
  });

  describe('Verification Flow', () => {
    test('should verify a valid VC off-chain with holder proof and anchored root', async () => {
      const vcId = 'urn:uuid:credential-1';
      const claims = { course: 'Blockchain 101' };

      // 1. Issue VC
      const vc = issueCredential(vcId, learnerKeys.did, claims, issuerKeys.did, issuerKeys.privateKeyPem) as VerifiableCredential;

      // 2. Setup status registry
      const registry = new StatusRegistry();
      registry.register(vcId);
      const rootHash = registry.computeStatusRoot();

      // 3. Holder proof
      const nonce = 'session-nonce';
      const holderSig = signChallenge(nonce, learnerKeys.privateKeyPem);
      const holderProof = { nonce, signature: holderSig };

      // 4. Mock Algorand client
      (algodClient.getTransactionParams as jest.Mock).mockReturnValue({
        do: jest.fn().mockResolvedValue({
          fee: 1000n,
          genesisHash: Buffer.from('SGO1GKSzyE7IEPko1593n1w1c01knGB78ODDHLGEBYo=', 'base64'),
          genesisId: 'mainnet-v1.0',
          firstValid: 1000n,
          lastValid: 2000n,
          minFee: 1000n,
        }),
      });

      (algodClient.sendRawTransaction as jest.Mock).mockReturnValue({
        do: jest.fn().mockResolvedValue({ txid: mockTxId }),
      });

      // Mock wait for confirmation returning the transaction details containing the note
      const noteData = { rootHash, epochVersion: 1 };
      const noteBytes = new TextEncoder().encode(JSON.stringify(noteData));

      (algosdk.waitForConfirmation as jest.Mock).mockResolvedValue({
        txn: {
          txn: {
            fee: 1000n,
            note: noteBytes,
          },
        },
      });

      (algodClient.pendingTransactionInformation as jest.Mock).mockReturnValue({
        do: jest.fn().mockResolvedValue({
          txn: {
            txn: {
              fee: 1000n,
              note: noteBytes,
            },
          },
        }),
      });

      // Anchor status
      const issuerAccount = algosdk.generateAccount();
      const anchorRes = await anchorStatusToMainnet(issuerAccount, rootHash, 1);
      expect(anchorRes.txId).toBe(mockTxId);

      // Verify B2
      const verification = await verifyCredentialB2(
        vc,
        holderProof,
        mockTxId,
        registry.getRecordsList()
      );

      expect(verification.isValid).toBe(true);
      expect(verification.epochVersion).toBe(1);
    });

    test('should fail verification if holder binding proof is invalid', async () => {
      const vcId = 'urn:uuid:credential-2';
      const vc = issueCredential(vcId, learnerKeys.did, {}, issuerKeys.did, issuerKeys.privateKeyPem) as VerifiableCredential;

      const registry = new StatusRegistry();
      registry.register(vcId);
      const rootHash = registry.computeStatusRoot();

      // Holder signature of a DIFFERENT nonce (simulates attack or invalid proof)
      const holderSig = signChallenge('wrong-nonce', learnerKeys.privateKeyPem);
      const holderProof = { nonce: 'correct-nonce', signature: holderSig };

      const noteBytes = new TextEncoder().encode(JSON.stringify({ rootHash, epochVersion: 1 }));
      (algodClient.pendingTransactionInformation as jest.Mock).mockReturnValue({
        do: jest.fn().mockResolvedValue({
          txn: { txn: { note: noteBytes } },
        }),
      });

      const verification = await verifyCredentialB2(
        vc,
        holderProof,
        mockTxId,
        registry.getRecordsList()
      );

      expect(verification.isValid).toBe(false);
      expect(verification.error).toContain('Holder binding proof signature is invalid');
    });

    test('should fail verification if status registry is tempered (hash mismatch)', async () => {
      const vcId = 'urn:uuid:credential-3';
      const vc = issueCredential(vcId, learnerKeys.did, {}, issuerKeys.did, issuerKeys.privateKeyPem) as VerifiableCredential;

      const registry = new StatusRegistry();
      registry.register(vcId);
      const rootHash = registry.computeStatusRoot();

      const holderSig = signChallenge('session-nonce', learnerKeys.privateKeyPem);
      const holderProof = { nonce: 'session-nonce', signature: holderSig };

      const noteBytes = new TextEncoder().encode(JSON.stringify({ rootHash, epochVersion: 1 }));
      (algodClient.pendingTransactionInformation as jest.Mock).mockReturnValue({
        do: jest.fn().mockResolvedValue({
          txn: { txn: { note: noteBytes } },
        }),
      });

      // Tempered list (e.g. learner claims they are valid but local records say revoked or vice versa)
      const temperedList = [{ id: vcId, status: 'revoked' as const }];

      const verification = await verifyCredentialB2(
        vc,
        holderProof,
        mockTxId,
        temperedList
      );

      expect(verification.isValid).toBe(false);
      expect(verification.error).toContain('Status list integrity check failed');
    });
  });
});
