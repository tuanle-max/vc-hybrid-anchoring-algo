import { generateIssuerKeys, issueCredential, issueCredentialWithLatency, revokeCredential, statusRegistry } from '../src/b0_centralized/issuer';
import { verifyCredential, verifyCredentialWithLatency } from '../src/b0_centralized/verifier';

describe('Baseline 0: Centralized VC Issuance and Verification', () => {
  let issuerKeys: { publicKey: string; privateKey: string };
  const issuerDid = 'did:key:z6MkpTHR8VNsBxRbhSTgE4m7hgXpBU8KKCsV8w7s2v15t';
  const subjectId = 'did:key:z6MkgYDYCHr2GgRV7k15M275g55365532553';
  const testClaims = { name: 'Alice Smith', degree: 'BSc Computer Science' };
  const credentialId = 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

  beforeAll(() => {
    issuerKeys = generateIssuerKeys();
  });

  beforeEach(() => {
    statusRegistry.clear();
  });

  test('should issue a credential and verify it successfully', () => {
    const vc = issueCredential(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);

    expect(vc.id).toBe(credentialId);
    expect(vc.issuer).toBe(issuerDid);
    expect(vc.credentialSubject.name).toBe('Alice Smith');
    expect(vc.proof).toBeDefined();

    const verification = verifyCredential(vc, issuerKeys.publicKey);
    expect(verification.isValid).toBe(true);
    expect(verification.error).toBeUndefined();
  });

  test('should track latency during issuance and verification wrappers', () => {
    const issuanceWrap = issueCredentialWithLatency(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);
    expect(issuanceWrap.durationMs).toBeGreaterThanOrEqual(0);
    expect(issuanceWrap.result.id).toBe(credentialId);

    const verificationWrap = verifyCredentialWithLatency(issuanceWrap.result, issuerKeys.publicKey);
    expect(verificationWrap.durationMs).toBeGreaterThanOrEqual(0);
    expect(verificationWrap.result.isValid).toBe(true);
  });

  test('should fail verification if the credential is revoked', () => {
    const vc = issueCredential(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);
    
    // Revoke the VC
    revokeCredential(credentialId);

    const verification = verifyCredential(vc, issuerKeys.publicKey);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('revoked');
  });

  test('should fail verification if the signature is verified with the wrong public key', () => {
    const vc = issueCredential(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);
    const otherKeys = generateIssuerKeys();

    const verification = verifyCredential(vc, otherKeys.publicKey);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('Cryptographic signature is invalid');
  });

  test('should fail verification if the credential content has been modified after issuance', () => {
    const vc = issueCredential(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);
    
    // Tamper with claims
    const tamperedVc = {
      ...vc,
      credentialSubject: {
        ...vc.credentialSubject,
        degree: 'PhD Computer Science' // modified degree
      }
    };

    const verification = verifyCredential(tamperedVc, issuerKeys.publicKey);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('Cryptographic signature is invalid');
  });

  test('should fail verification if credential is not registered at all', () => {
    const vc = issueCredential(credentialId, subjectId, testClaims, issuerDid, issuerKeys.privateKey);
    
    // Remove from in-memory status registry
    statusRegistry.delete(credentialId);

    const verification = verifyCredential(vc, issuerKeys.publicKey);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('not found in registry');
  });
});
