import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientId } from '@/lib/client-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createClientId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when available', () => {
    expect(createClientId()).toMatch(UUID_V4);
  });

  it('falls back when crypto.randomUUID is missing (insecure context)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const a = createClientId();
    const b = createClientId();
    expect(a).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('still works with no crypto object at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createClientId()).toMatch(UUID_V4);
  });
});
