import algosdk from 'algosdk';
import { algodClient } from '../shared/algorand_client';

export interface IssueResultB1 {
  assetId: number;
  totalFeesMicroAlgos: number;
  durationMs: number;
  txIds: {
    create: string;
    optIn: string;
    transfer: string;
    freeze: string;
  };
}

export interface VerifyResultB1 {
  isValid: boolean;
  isFrozen: boolean;
  amount: number;
  durationMs: number;
}

/**
 * Helper to send a transaction, wait for confirmation, and extract the actual fee charged.
 */
async function sendTransactionAndGetFee(
  txn: algosdk.Transaction,
  secretKey: Uint8Array
): Promise<{ txId: string; feeCharged: number }> {
  const signedTxn = txn.signTxn(secretKey);
  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txid;

  // Wait for confirmation
  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 4);

  // Extract actual confirmed fee (which is txn.fee in v3)
  let feeCharged = Number(txn.fee);
  if (ptx && ptx.txn && ptx.txn.txn && ptx.txn.txn.fee !== undefined) {
    feeCharged = Number(ptx.txn.txn.fee);
  }

  return { txId, feeCharged };
}

/**
 * Issues a legacy credential as an ASA on Algorand.
 * Steps: ASA creation, Learner Opt-In, Transfer, and Freeze.
 */
export async function issueCredentialB1(
  issuerAccount: algosdk.Account,
  learnerAccount: algosdk.Account
): Promise<IssueResultB1> {
  const start = performance.now();
  let totalFeesMicroAlgos = 0;

  // 1. Get transaction parameters
  const suggestedParams = await algodClient.getTransactionParams().do();

  // 2. Create Zero-Decimal ASA
  const createTxn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: issuerAccount.addr.toString(),
    suggestedParams,
    total: 1,
    decimals: 0,
    defaultFrozen: false,
    unitName: 'VCO',
    assetName: 'VC Legacy Token',
    manager: issuerAccount.addr.toString(),
    reserve: issuerAccount.addr.toString(),
    freeze: issuerAccount.addr.toString(),
    clawback: issuerAccount.addr.toString(),
  });

  const createRes = await sendTransactionAndGetFee(createTxn, issuerAccount.sk);
  const assetId = await getCreatedAssetId(createRes.txId);
  totalFeesMicroAlgos += createRes.feeCharged;

  // 3. Learner Opt-In to ASA
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: learnerAccount.addr.toString(),
    receiver: learnerAccount.addr.toString(),
    amount: 0,
    assetIndex: assetId,
    suggestedParams,
  });

  const optInRes = await sendTransactionAndGetFee(optInTxn, learnerAccount.sk);
  totalFeesMicroAlgos += optInRes.feeCharged;

  // 4. Transfer ASA Issuer -> Learner
  const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: issuerAccount.addr.toString(),
    receiver: learnerAccount.addr.toString(),
    amount: 1,
    assetIndex: assetId,
    suggestedParams,
  });

  const transferRes = await sendTransactionAndGetFee(transferTxn, issuerAccount.sk);
  totalFeesMicroAlgos += transferRes.feeCharged;

  // 5. Freeze Learner's ASA token
  const freezeTxn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
    sender: issuerAccount.addr.toString(),
    freezeTarget: learnerAccount.addr.toString(),
    assetIndex: assetId,
    frozen: true,
    suggestedParams,
  });

  const freezeRes = await sendTransactionAndGetFee(freezeTxn, issuerAccount.sk);
  totalFeesMicroAlgos += freezeRes.feeCharged;

  const end = performance.now();

  return {
    assetId,
    totalFeesMicroAlgos,
    durationMs: end - start,
    txIds: {
      create: createRes.txId,
      optIn: optInRes.txId,
      transfer: transferRes.txId,
      freeze: freezeRes.txId,
    },
  };
}

/**
 * Helper to fetch the created asset ID from transaction information.
 */
async function getCreatedAssetId(txId: string): Promise<number> {
  const txInfo = await algodClient.pendingTransactionInformation(txId).do();
  const assetId = txInfo.assetIndex;
  if (assetId === undefined) {
    throw new Error(`Failed to find created asset ID for transaction: ${txId}`);
  }
  return Number(assetId);
}

/**
 * Verifies the legacy token ownership credential.
 * Confirms learner holds 1 unit and the holding is frozen.
 */
export async function verifyCredentialB1(
  learnerAddress: string,
  assetId: number
): Promise<VerifyResultB1> {
  const start = performance.now();

  try {
    const accountInfo = await algodClient.accountAssetInformation(learnerAddress, assetId).do();
    const assetHolding = accountInfo.assetHolding;

    if (!assetHolding) {
      const end = performance.now();
      return {
        isValid: false,
        isFrozen: false,
        amount: 0,
        durationMs: end - start,
      };
    }

    const amount = Number(assetHolding.amount);
    const isFrozen = !!assetHolding.isFrozen;
    const isValid = amount === 1 && isFrozen;

    const end = performance.now();
    return {
      isValid,
      isFrozen,
      amount,
      durationMs: end - start,
    };
  } catch (error) {
    const end = performance.now();
    return {
      isValid: false,
      isFrozen: false,
      amount: 0,
      durationMs: end - start,
    };
  }
}
