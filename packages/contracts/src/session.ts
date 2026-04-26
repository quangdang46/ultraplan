export type SessionStatus = 'active' | 'archived' | 'error'

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface Session {
  id: string
  title: string
  description: string
  status: SessionStatus
  branch?: string
  tag?: string
  diff?: string
  pr?: string
  messageCount?: number
  lastMessageAt?: string
  createdAt: string
  cwd?: string
}
