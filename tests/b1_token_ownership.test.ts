import algosdk from 'algosdk';
import { issueCredentialB1, verifyCredentialB1 } from '../src/b1_token_ownership/index';
import { algodClient } from '../src/shared/algorand_client';

jest.mock('../src/shared/algorand_client', () => {
  const mockAlgodClient = {
    getTransactionParams: jest.fn(),
    sendRawTransaction: jest.fn(),
    pendingTransactionInformation: jest.fn(),
    accountAssetInformation: jest.fn(),
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

describe('Baseline 1: Legacy Token Ownership (B1)', () => {
  const issuerAccount = algosdk.generateAccount();
  const learnerAccount = algosdk.generateAccount();
  const mockAssetId = 987654321;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should execute the issuance flow and return confirmed fees and duration', async () => {
    // 1. Mock getTransactionParams
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

    // 2. Mock sendRawTransaction
    (algodClient.sendRawTransaction as jest.Mock).mockReturnValue({
      do: jest.fn().mockResolvedValue({ txid: 'mock-txid-123' }),
    });

    // 3. Mock waitForConfirmation
    (algosdk.waitForConfirmation as jest.Mock).mockResolvedValue({
      txn: {
        txn: {
          fee: 1000n,
        },
      },
      assetIndex: BigInt(mockAssetId),
    });

    // 4. Mock pendingTransactionInformation for asset creation ID extraction
    (algodClient.pendingTransactionInformation as jest.Mock).mockReturnValue({
      do: jest.fn().mockResolvedValue({
        assetIndex: BigInt(mockAssetId),
      }),
    });

    const result = await issueCredentialB1(issuerAccount, learnerAccount);

    expect(result.assetId).toBe(mockAssetId);
    expect(result.totalFeesMicroAlgos).toBe(4000); // 4 txs * 1000 microalgos
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.txIds.create).toBe('mock-txid-123');

    expect(algodClient.getTransactionParams).toHaveBeenCalledTimes(1);
    expect(algodClient.sendRawTransaction).toHaveBeenCalledTimes(4);
    expect(algosdk.waitForConfirmation).toHaveBeenCalledTimes(4);
  });

  test('should verify the token ownership successfully if learner holds frozen asset', async () => {
    (algodClient.accountAssetInformation as jest.Mock).mockReturnValue({
      do: jest.fn().mockResolvedValue({
        assetHolding: {
          amount: 1n,
          assetId: BigInt(mockAssetId),
          isFrozen: true,
        },
      }),
    });

    const result = await verifyCredentialB1(learnerAccount.addr.toString(), mockAssetId);

    expect(result.isValid).toBe(true);
    expect(result.isFrozen).toBe(true);
    expect(result.amount).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(algodClient.accountAssetInformation).toHaveBeenCalledWith(learnerAccount.addr.toString(), mockAssetId);
  });

  test('should fail verification if asset is not frozen', async () => {
    (algodClient.accountAssetInformation as jest.Mock).mockReturnValue({
      do: jest.fn().mockResolvedValue({
        assetHolding: {
          amount: 1n,
          assetId: BigInt(mockAssetId),
          isFrozen: false, // not frozen
        },
      }),
    });

    const result = await verifyCredentialB1(learnerAccount.addr.toString(), mockAssetId);

    expect(result.isValid).toBe(false);
    expect(result.isFrozen).toBe(false);
  });

  test('should fail verification if learner does not own the asset (amount is 0)', async () => {
    (algodClient.accountAssetInformation as jest.Mock).mockReturnValue({
      do: jest.fn().mockResolvedValue({
        assetHolding: {
          amount: 0n,
          assetId: BigInt(mockAssetId),
          isFrozen: true,
        },
      }),
    });

    const result = await verifyCredentialB1(learnerAccount.addr.toString(), mockAssetId);

    expect(result.isValid).toBe(false);
    expect(result.amount).toBe(0);
  });
});
