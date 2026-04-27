import { useState, useCallback, useEffect } from 'react'
import { getApiClient } from '../api/client'
import type { Session, SessionMessage } from '../api/types'
import { ensureApiAuthenticated } from '../features/chat/streamTransport'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const client = getApiClient()

  const fetchSessions = useCallback(async () => {
    try {
      await ensureApiAuthenticated(client)
      const resp = await client.getSessions()
      // Deduplicate: server response may include sessions already in local state
      // (e.g. from optimistic createSession). Use a Map to dedupe by ID.
      setSessions((prev) => {
        const byId = new Map<string, Session>()
        for (const s of prev) byId.set(s.id, s)
        for (const s of resp.sessions) byId.set(s.id, s)
        return Array.from(byId.values())
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [client])

  // Initial load + 10s polling
  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    const id = setInterval(() => void fetchSessions(), 10_000)
    return () => clearInterval(id)
  }, [fetchSessions])

  // Load transcript history for a given sessionId
  const loadHistory = useCallback(
    async (sessionId: string): Promise<SessionMessage[]> => {
      setHistoryLoading(true)
      try {
        await ensureApiAuthenticated(client)
        const messages = await client.getSessionMessages(sessionId)
        return messages
      } finally {
        setHistoryLoading(false)
      }
    },
    [client]
  )

  const createSession = useCallback(
    async (cwd?: string): Promise<Session> => {
      await ensureApiAuthenticated(client)
      const session = await client.createSession(cwd)
      // Optimistically add to sessions list so the effect in Index.tsx that syncs
      // activeSession from sessions finds the new session immediately (before refetch
      // would overwrite with a server response that doesn't include it yet).
      setSessions((prev) => [...prev, session])
      return session
    },
    [client]
  )

  const killSession = useCallback(
    async (sessionId: string): Promise<void> => {
      await ensureApiAuthenticated(client)
      await client.killSession(sessionId)
      await fetchSessions()
    },
    [client, fetchSessions]
  )

  const renameSession = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      await ensureApiAuthenticated(client)
      await client.renameSession(sessionId, name)
      await fetchSessions()
    },
    [client, fetchSessions]
  )

  return {
    sessions,
    loading,
    error,
    historyLoading,
    refetch: fetchSessions,
    loadHistory,
    createSession,
    killSession,
    renameSession,
  }
}
