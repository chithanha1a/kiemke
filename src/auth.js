// Keep this format compatible with existing users: salt:PBKDF2-SHA256 hex, 100000 iterations.
export async function hashPassword(value, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return salt + ':' + Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('');
}
export function normalizeSetupToken(value) { return typeof value === 'string' ? value.trim() : ''; }
