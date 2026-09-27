import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { base64ToBytes, bytesToBase64, utf8 } from './encoding';
import { loadSeed, saveSeed } from './storage';

/**
 * Canonical signed messages. MUST stay byte-for-byte identical to
 * backend/src/services/signature.ts.
 */
const SIG_PREFIX = 'mr-rokesh-auth:v1';
export type Decision = 'APPROVE' | 'DENY';

export const enrollMessage = (enrollmentToken: string, publicKeyB64: string) =>
  `${SIG_PREFIX}:enroll\n${enrollmentToken}\n${publicKeyB64}`;

export const respondMessage = (challengeId: string, nonce: string, decision: Decision, timestamp: number) =>
  `${SIG_PREFIX}:respond\n${challengeId}\n${nonce}\n${decision}\n${timestamp}`;

export const requestMessage = (method: string, path: string, timestamp: number, body: string) =>
  `${SIG_PREFIX}:request\n${method.toUpperCase()}\n${path}\n${timestamp}\n${bytesToHex(sha256(utf8(body)))}`;

/**
 * Creates a new Ed25519 keypair from 32 bytes of OS CSPRNG output and stores the seed
 * in secure storage. The private key never leaves the device.
 */
export async function createDeviceKeypair(): Promise<{ publicKey: string }> {
  const seed = Crypto.getRandomBytes(32);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  await saveSeed(bytesToBase64(seed));
  return { publicKey: bytesToBase64(kp.publicKey) };
}

async function secretKey(): Promise<Uint8Array> {
  const seed = await loadSeed();
  if (!seed) throw new Error('Device key missing — re-enroll this device');
  return nacl.sign.keyPair.fromSeed(base64ToBytes(seed)).secretKey;
}

export async function sign(message: string): Promise<string> {
  return bytesToBase64(nacl.sign.detached(utf8(message), await secretKey()));
}
