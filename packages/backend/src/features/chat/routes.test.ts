import { describe, expect, test } from 'bun:test'
import { handleChatRoute } from './routes'

describe('handleChatRoute validation', () => {
  test('returns CHAT_MESSAGE_MISSING when message is empty and quote missing', async () => {
    const req = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ message: '   ' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handleChatRoute(req, '/api/chat/stream')
    expect(response).not.toBeNull()
    expect(response?.status).toBe(400)
    const payload = await response?.json()
    expect(payload.error).toBe('CHAT_MESSAGE_MISSING')
  })

  test('accepts quote-only payload without message', async () => {
    const req = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ quote: { text: 'quoted only' } }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handleChatRoute(req, '/api/chat/stream')
    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
  })

  test('returns QUOTE_TYPE_INVALID when quote is not an object', async () => {
    const req = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello', quote: 'bad-quote' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handleChatRoute(req, '/api/chat/stream')
    expect(response).not.toBeNull()
    expect(response?.status).toBe(400)
    const payload = await response?.json()
    expect(payload.error).toBe('QUOTE_TYPE_INVALID')
  })

  test('returns QUOTE_EMPTY when quote.text is blank', async () => {
    const req = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello', quote: { text: '   ' } }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await handleChatRoute(req, '/api/chat/stream')
    expect(response).not.toBeNull()
    expect(response?.status).toBe(400)
    const payload = await response?.json()
    expect(payload.error).toBe('QUOTE_EMPTY')
  })
})
