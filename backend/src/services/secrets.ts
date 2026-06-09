import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

// Derive a 32-byte key from SECRETS_KEY. Falls back to a deterministic dev key
// if none is configured (secrets stored unencrypted-equivalent — warn loudly).
function getKey(): Buffer {
  if (!config.secretsKey) {
    console.warn('[secrets] WARNING: SECRETS_KEY is not set — provider secrets are stored with a weak default key. Set SECRETS_KEY in production.');
    return Buffer.alloc(32, 0x42);
  }
  const k = Buffer.from(config.secretsKey, 'utf-8');
  if (k.length >= 32) return k.subarray(0, 32);
  const padded = Buffer.alloc(32, 0);
  k.copy(padded);
  return padded;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: <iv_hex>:<tag_hex>:<ciphertext_hex>
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  const key = getKey();
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf-8') + decipher.final('utf-8');
}

export function encryptObject(obj: Record<string, unknown>): string {
  return encrypt(JSON.stringify(obj));
}

export function decryptObject(encoded: string): Record<string, unknown> {
  try {
    return JSON.parse(decrypt(encoded));
  } catch {
    return {};
  }
}
