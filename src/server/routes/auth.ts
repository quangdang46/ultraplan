// src/server/routes/auth.ts
// Auth routes for API key management

import { jsonResponse, corsResponse } from '../utils.js'

const DEV_API_KEY = `dev-key-${process.env.USER ?? 'local'}`
const STATIC_API_KEY = process.env.CLAUDE_CODE_SERVER_API_KEY

export async function authRoutes(req: Request, path: string, allowedOrigin: string): Promise<Response> {
  if (req.method === 'OPTIONS') return corsResponse(allowedOrigin)

  if (path === '/api/auth/init' && req.method === 'POST') {
    const tempToken = crypto.randomUUID()
    return jsonResponse({
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
  }

  if (path === '/api/auth/verify' && req.method === 'POST') {
    await req.json().catch(() => ({}))
    const apiKey = STATIC_API_KEY ?? DEV_API_KEY
    if (!apiKey) {
      return jsonResponse({ success: false, error: 'SERVER_API_KEY_NOT_CONFIGURED' }, 500)
    }
    return jsonResponse({
      apiKey,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
  }

  if (path === '/api/auth/validate' && req.method === 'GET') {
    const auth = req.headers.get('Authorization')
    const key = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    const valid = key === STATIC_API_KEY || key === DEV_API_KEY
    return jsonResponse({ valid: Boolean(valid) })
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404)
}
