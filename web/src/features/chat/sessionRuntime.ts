export function shouldPreserveLiveSession(
  routeSessionId: string | null,
  liveSessionId: string | null,
  isStreaming: boolean,
): boolean {
  return Boolean(routeSessionId) && routeSessionId === liveSessionId && isStreaming;
}

export function shouldHydrateRouteSession(
  routeSessionId: string | null,
  liveSessionId: string | null,
  hasLiveMessages: boolean,
): boolean {
  if (!routeSessionId) {
    return false;
  }

  if (routeSessionId !== liveSessionId) {
    return true;
  }

  return !hasLiveMessages;
}

export function shouldAdoptPendingSessionRoute(
  routeSessionId: string | null,
  liveSessionId: string | null,
  pendingRouteSync: boolean,
): boolean {
  return pendingRouteSync && Boolean(liveSessionId) && liveSessionId !== routeSessionId;
}
