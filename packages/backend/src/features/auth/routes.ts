import { issueApiKey, validateApiKey } from './authStore'
import { createJsonResponse } from '../../shared/http'

export async function handleAuthRoute(req: Request, path: string): Promise<Response | null> {
  if (req.method === 'POST' && path === '/api/auth/init') {
    const tempToken = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    return createJsonResponse({
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
  }

  if (req.method === 'POST' && path === '/api/auth/verify') {
    const body = (await req.json().catch(() => null)) as { tempToken?: string } | null
    if (!body?.tempToken?.startsWith('tmp_')) {
      return createJsonResponse({ success: false, error: 'INVALID_INPUT', message: 'Invalid token' }, 400)
    }
    return createJsonResponse(issueApiKey())
  }

  if (req.method === 'GET' && path === '/api/auth/validate') {
    return createJsonResponse({ valid: validateApiKey(req.headers.get('Authorization')) })
  }

  return null
}

export const PUBLIC_API_PATHS = new Set([
  '/api/auth/init',
  '/api/auth/verify',
  '/api/auth/validate',
  '/api/suggest/files',
  '/api/suggest/commands',
])
