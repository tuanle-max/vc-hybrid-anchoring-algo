import * as crypto from 'crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a buffer into a Base58 string.
 */
export function base58Encode(buffer: Buffer): string {
  let result = '';
  let x = BigInt('0x' + buffer.toString('hex'));
  while (x > 0n) {
    const idx = Number(x % 58n);
    result = ALPHABET[idx] + result;
    x = x / 58n;
  }
  // Handle leading zeros
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    result = ALPHABET[0] + result;
  }
  return result;
}

/**
 * Decodes a Base58 string into a buffer.
 */
export function base58Decode(str: string): Buffer {
  let x = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58 character');
    x = x * 58n + BigInt(idx);
  }
  let hex = x.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  let buffer = Buffer.from(hex, 'hex');
  // Handle leading zeros
  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++) {
    leadingZeros++;
  }
  if (leadingZeros > 0) {
    buffer = Buffer.concat([Buffer.alloc(leadingZeros), buffer]);
  }
  return buffer;
}

export interface DIDKeyPair {
  did: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generates an Ed25519 keypair and constructs a standard did:key.
 */
export function generateDIDKeyPair(): DIDKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPublicKey = der.subarray(der.length - 32);
  
  // did:key prefix for Ed25519 is 0xed 0x01
  const prefixedKey = Buffer.concat([Buffer.from([0xed, 0x01]), rawPublicKey]);
  const did = `did:key:z${base58Encode(prefixedKey)}`;

  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  return { did, publicKeyPem, privateKeyPem };
}

/**
 * Resolves a did:key string into a PEM public key.
 */
export function resolveDIDToPublicKey(did: string): string {
  if (!did.startsWith('did:key:z')) {
    throw new Error('Unsupported DID format. Only did:key with Base58btc Ed25519 is supported.');
  }

  const base58Part = did.substring(9); // strip "did:key:z"
  const decoded = base58Decode(base58Part);

  // Verification method prefix check
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Unsupported multicodec prefix. Expected Ed25519 (0xed 0x01).');
  }

  const rawPublicKey = decoded.subarray(2);
  const derHeader = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([derHeader, rawPublicKey]);

  const publicKey = crypto.createPublicKey({
    key: der,
    format: 'der',
    type: 'spki',
  });

  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}

/**
 * Signs a nonce challenge using a DID private key.
 */
export function signChallenge(nonce: string, privateKeyPem: string): string {
  const data = Buffer.from(nonce);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, data, privateKey);
  return signature.toString('hex');
}

/**
 * Verifies a challenge signature using a DID or a PEM public key.
 */
export function verifyChallenge(nonce: string, signatureHex: string, identity: string): boolean {
  const data = Buffer.from(nonce);
  const signature = Buffer.from(signatureHex, 'hex');

  let publicKeyPem = identity;
  if (identity.startsWith('did:key:')) {
    publicKeyPem = resolveDIDToPublicKey(identity);
  }

  const publicKey = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, data, publicKey, signature);
}
