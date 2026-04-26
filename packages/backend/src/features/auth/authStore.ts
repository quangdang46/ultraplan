const apiKeys = new Map<string, { expiresAt: number }>()

export function issueApiKey(): { apiKey: string; expiresAt: string } {
  const apiKey = `sk_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000
  apiKeys.set(apiKey, { expiresAt: expiresAtMs })
  return {
    apiKey,
    expiresAt: new Date(expiresAtMs).toISOString(),
  }
}

export function validateApiKey(auth: string | null): boolean {
  if (!auth) return false
  const key = auth.replace('Bearer ', '')
  const entry = apiKeys.get(key)
  if (!entry) return false
  return entry.expiresAt > Date.now()
}
