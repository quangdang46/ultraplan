import { describe, expect, test, vi } from 'vitest';
import { ensureApiAuthenticated } from './streamTransport';

describe('ensureApiAuthenticated', () => {
  test('preserves the existing API key when auth validation fails transiently', async () => {
    const client = {
      hasApiKey: vi.fn(() => true),
      authValidate: vi.fn(async () => {
        throw new Error('Network request failed');
      }),
      clearApiKey: vi.fn(),
      authInit: vi.fn(async () => ({ tempToken: 'temp-token' })),
      authVerify: vi.fn(async () => ({ apiKey: 'new-key' })),
    };

    await expect(ensureApiAuthenticated(client as any)).rejects.toThrow('Network request failed');
    expect(client.clearApiKey).not.toHaveBeenCalled();
    expect(client.authInit).not.toHaveBeenCalled();
    expect(client.authVerify).not.toHaveBeenCalled();
  });

  test('re-authenticates when the stored API key is explicitly invalid', async () => {
    const client = {
      hasApiKey: vi.fn(() => true),
      authValidate: vi.fn(async () => ({ valid: false })),
      clearApiKey: vi.fn(),
      authInit: vi.fn(async () => ({ tempToken: 'temp-token' })),
      authVerify: vi.fn(async () => ({ apiKey: 'new-key' })),
    };

    await expect(ensureApiAuthenticated(client as any)).resolves.toBeUndefined();
    expect(client.clearApiKey).toHaveBeenCalledTimes(1);
    expect(client.authInit).toHaveBeenCalledTimes(1);
    expect(client.authVerify).toHaveBeenCalledWith('temp-token');
  });
});
