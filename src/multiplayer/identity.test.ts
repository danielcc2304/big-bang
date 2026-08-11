import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createReconnectToken, hashReconnectToken } from './identity';

describe('reconexión segura', () => {
  it('genera secretos distintos y almacena solo una prueba hashable en servidor', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    const first = createReconnectToken(); const second = createReconnectToken();
    expect(first).not.toBe(second);
    const hash = await hashReconnectToken(first);
    expect(hash).toHaveLength(64); expect(hash).not.toContain(first);
    expect(await hashReconnectToken(first)).toBe(hash);
    expect(await hashReconnectToken(second)).not.toBe(hash);
  });
});
