import algosdk from 'algosdk';
import { algodClient } from '../shared/algorand_client';

export const APPROVAL_TEAL = `#pragma version 6
txn ApplicationID
int 0
==
bnz handle_creation

txn OnCompletion
int NoOp
==
bnz handle_noop

err

handle_creation:
int 1
return

handle_noop:
txn Sender
global CreatorAddress
==
assert
byte "status_root"
txna ApplicationArgs 0
app_global_put
int 1
return`;

export const CLEAR_TEAL = `#pragma version 6
int 1
return`;

/**
 * Helper to compile TEAL code via algod.
 */
async function compileTeal(tealCode: string): Promise<Uint8Array> {
  const compileRes = await algodClient.compile(Buffer.from(tealCode)).do();
  return Buffer.from(compileRes.result, 'base64');
}

/**
 * Deploys the B6 Smart Contract to Algorand Mainnet.
 */
export async function deployApplication(
  issuerAccount: algosdk.Account
): Promise<{ appId: number; feeCharged: number; txId: string; confirmedRound: number }> {
  const approvalBytes = await compileTeal(APPROVAL_TEAL);
  const clearBytes = await compileTeal(CLEAR_TEAL);

  const suggestedParams = await algodClient.getTransactionParams().do();

  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: issuerAccount.addr.toString(),
    suggestedParams,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approvalBytes,
    clearProgram: clearBytes,
    numGlobalByteSlices: 1,
    numGlobalInts: 0,
    numLocalByteSlices: 0,
    numLocalInts: 0,
  });

  const signedTxn = txn.signTxn(issuerAccount.sk);
  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txid;

  // Wait for confirmation
  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 4);

  let feeCharged = Number(txn.fee);
  if (ptx && ptx.txn && ptx.txn.txn && ptx.txn.txn.fee !== undefined) {
    feeCharged = Number(ptx.txn.txn.fee);
  }

  const appId = ptx.applicationIndex;
  if (appId === undefined) {
    throw new Error(`Failed to retrieve application ID for creation transaction: ${txId}`);
  }

  const confirmedRound = ptx && (ptx as any).confirmedRound
    ? Number((ptx as any).confirmedRound)
    : 0;

  return {
    appId: Number(appId),
    feeCharged,
    txId,
    confirmedRound,
  };
}

/**
 * Sends an Application Call (NoOp) to update the status root in the contract's Global State.
 */
export async function updateStatusRootB6(
  issuerAccount: algosdk.Account,
  appId: number,
  newRoot: string
): Promise<{ txId: string; feeCharged: number; durationMs: number; confirmedRound: number }> {
  const start = performance.now();

  const suggestedParams = await algodClient.getTransactionParams().do();
  const appArgs = [new TextEncoder().encode(newRoot)];

  const txn = algosdk.makeApplicationCallTxnFromObject({
    sender: issuerAccount.addr.toString(),
    appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(issuerAccount.sk);
  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txid;

  // Wait for confirmation
  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 4);

  let feeCharged = Number(txn.fee);
  if (ptx && ptx.txn && ptx.txn.txn && ptx.txn.txn.fee !== undefined) {
    feeCharged = Number(ptx.txn.txn.fee);
  }

  const confirmedRound2 = ptx && (ptx as any).confirmedRound
    ? Number((ptx as any).confirmedRound)
    : 0;

  const end = performance.now();

  return {
    txId,
    feeCharged,
    durationMs: end - start,
    confirmedRound: confirmedRound2,
  };
}
