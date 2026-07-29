import * as crypto from 'crypto';
import algosdk from 'algosdk';
import { algodClient } from '../shared/algorand_client';
import { AnchoredStatusNote } from './types';

export class StatusRegistry {
  private records: Map<string, 'valid' | 'revoked'> = new Map();

  /**
   * Registers a credential ID as valid.
   */
  public register(id: string): void {
    this.records.set(id, 'valid');
  }

  /**
   * Revokes a credential ID.
   */
  public revoke(id: string): void {
    if (!this.records.has(id)) {
      throw new Error(`Credential ${id} not found in registry.`);
    }
    this.records.set(id, 'revoked');
  }

  /**
   * Computes a SHA-256 hash of the sorted bitstring-like list of VC statuses.
   */
  public computeStatusRoot(): string {
    const sortedEntries = Array.from(this.records.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    const serialized = sortedEntries
      .map(([id, status]) => `${id}:${status}`)
      .join(',');

    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Export records for verification reference.
   */
  public getRecordsList(): { id: string; status: 'valid' | 'revoked' }[] {
    return Array.from(this.records.entries()).map(([id, status]) => ({ id, status }));
  }
}

/**
 * Anchors the off-chain status Merkle/SHA root hash to Algorand Mainnet via a 0-ALGO transaction.
 * Embeds rootHash and epochVersion into the note field.
 */
export async function anchorStatusToMainnet(
  issuerAccount: algosdk.Account,
  rootHash: string,
  epochVersion: number
): Promise<{ txId: string; feeCharged: number; durationMs: number; confirmedRound: number }> {
  const start = performance.now();

  const suggestedParams = await algodClient.getTransactionParams().do();
  
  const noteData: AnchoredStatusNote = {
    rootHash,
    epochVersion,
  };
  const note = new TextEncoder().encode(JSON.stringify(noteData));

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: issuerAccount.addr.toString(),
    receiver: issuerAccount.addr.toString(),
    amount: 0,
    suggestedParams,
    note,
  });

  const signedTxn = txn.signTxn(issuerAccount.sk);
  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txid;

  // Wait for confirmation
  const ptx = await algosdk.waitForConfirmation(algodClient, txId, 4);

  // Extract actual confirmed fee
  let feeCharged = Number(txn.fee);
  if (ptx && ptx.txn && ptx.txn.txn && ptx.txn.txn.fee !== undefined) {
    feeCharged = Number(ptx.txn.txn.fee);
  }

  const confirmedRound = ptx && (ptx as any).confirmedRound
    ? Number((ptx as any).confirmedRound)
    : 0;

  const end = performance.now();

  return {
    txId,
    feeCharged,
    durationMs: end - start,
    confirmedRound,
  };
}
