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
      setSessions(resp.sessions)
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
      await fetchSessions()
      return session
    },
    [client, fetchSessions]
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
