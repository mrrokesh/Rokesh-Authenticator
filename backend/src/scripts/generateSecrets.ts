/**
 * Prints fresh values for the secret .env variables. Copy them into backend/.env.
 * Nothing is written to disk.
 */
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');

console.log(`JWT_PRIVATE_KEY="${oneLine(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(publicKey)}"`);
console.log(`TOTP_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64')}`);
console.log(`COMPANY_API_KEY=${crypto.randomBytes(32).toString('base64url')}`);
