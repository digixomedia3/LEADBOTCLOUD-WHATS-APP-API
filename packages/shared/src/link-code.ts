import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A 12-character code from the cryptographic random generator. 62^12 is about 3 x 10^21 possibilities, so a code cannot be guessed,
 * and the redirect also rate limits wrong guesses. Uses rejection sampling so every character is equally likely (no modulo bias).
 */
export function generateLinkCode(): string {
  let out = '';
  while (out.length < 12) {
    for (const b of randomBytes(24)) {
      if (b >= 248) continue; // 248 = 62 * 4, the largest multiple of 62 that fits in a byte
      out += ALPHABET[b % 62];
      if (out.length === 12) break;
    }
  }
  return out;
}
