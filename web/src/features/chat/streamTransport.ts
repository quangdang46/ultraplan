import { getApiClient } from '../../api/client';

export async function ensureApiAuthenticated(client = getApiClient()): Promise<void> {
  if (client.hasApiKey()) {
    try {
      const result = await client.authValidate();
      if (result.valid) return;
      client.clearApiKey();
    } catch {
      client.clearApiKey();
    }
  }
  const { tempToken } = await client.authInit();
  await client.authVerify(tempToken);
}
