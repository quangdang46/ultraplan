import { getApiClient } from '../../api/client';

export async function ensureApiAuthenticated(client = getApiClient()): Promise<void> {
  if (client.hasApiKey()) {
    try {
      const result = await client.authValidate();
      if (result.valid) return;
      client.clearApiKey();
    } catch (error) {
      // Preserve the current identity on transient network/server failures.
      // Re-authing here would mint a new UUID owner and orphan existing sessions.
      throw error;
    }
  }
  const { tempToken } = await client.authInit();
  await client.authVerify(tempToken);
}
