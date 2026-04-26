import { handleAuthRoute, PUBLIC_API_PATHS } from '../features/auth/routes'
import { validateApiKey } from '../features/auth/authStore'
import { handleChatRoute } from '../features/chat/routes'
import { handleComposerRoute } from '../features/composer/routes'
import { handleSessionsRoute } from '../features/sessions/routes'
import { handleSystemRoute } from '../features/system/routes'
import { createJsonResponse } from '../shared/http'
import { errorResponse } from '../shared/errors'

export async function routeRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  const authRouteResponse = await handleAuthRoute(req, path)
  if (authRouteResponse) return authRouteResponse

  if (path.startsWith('/api/') && !PUBLIC_API_PATHS.has(path)) {
    if (!validateApiKey(req.headers.get('Authorization'))) {
      return errorResponse('UNAUTHORIZED', 401, {
        message: 'Local API auth missing or expired',
        authDomain: 'web_api',
      })
    }
  }

  const chatRouteResponse = await handleChatRoute(req, path)
  if (chatRouteResponse) return chatRouteResponse

  const composerRouteResponse = await handleComposerRoute(req, path, url)
  if (composerRouteResponse) return composerRouteResponse

  const sessionsRouteResponse = await handleSessionsRoute(req, path)
  if (sessionsRouteResponse) return sessionsRouteResponse

  const systemRouteResponse = await handleSystemRoute(req, path)
  if (systemRouteResponse) return systemRouteResponse

  return createJsonResponse({ success: false, error: 'NOT_FOUND' }, 404)
}
