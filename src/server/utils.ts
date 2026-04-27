// src/server/utils.ts
// Shared HTTP utilities for server routes

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// CORS preflight response
export function corsResponse(origin: string): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

// Create CORS headers object
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

// Wrap a Response with CORS headers - works with ReadableStream bodies
export function withCors(response: Response, origin: string): Response {
  const headers = new Headers()

  // Copy existing headers
  if (response.headers) {
    for (const [key, value] of response.headers.entries()) {
      headers.set(key, value)
    }
  }

  // Set CORS headers (these take precedence)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function notFoundResponse(origin: string): Response {
  return withCors(jsonResponse({ error: 'NOT_FOUND' }, 404), origin)
}

export function errorResponse(code: string, message: string, status = 500, origin?: string): Response {
  const resp = jsonResponse({ success: false, error: code, message }, status)
  return origin ? withCors(resp, origin) : resp
}

export function createSseResponse(stream: ReadableStream, origin: string): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}