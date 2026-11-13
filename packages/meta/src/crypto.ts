import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Token encryption at rest (AGENTS.md rule 7, spec 2.3): AES-256-GCM with a key from env TOKEN_ENCRYPTION_KEY (32 bytes, base64).
 * Output format: v1.<iv>.<tag>.<ciphertext>, all base64url. GCM authenticates, so a tampered value fails to decrypt.
 * Never log a token or its ciphertext.
 */
function keyFrom(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return k;
}

export function encryptSecret(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, keyB64: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', keyFrom(keyB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** Random 6-digit two-step-verification PIN for /register (spec 2.2 step 9). */
export function randomPin(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
