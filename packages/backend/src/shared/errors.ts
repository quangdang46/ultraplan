import { createJsonResponse } from './http'

export type AuthDomain = 'web_api' | 'bridge_oauth' | 'session_ingress'

export type ErrorEnvelope = {
  success: false
  error: string
  message?: string
  auth_domain?: AuthDomain
}

export function errorResponse(
  error: string,
  status: number,
  options?: { message?: string; authDomain?: AuthDomain },
): Response {
  const payload: ErrorEnvelope = {
    success: false,
    error,
    message: options?.message,
    auth_domain: options?.authDomain,
  }
  return createJsonResponse(payload, status)
}
