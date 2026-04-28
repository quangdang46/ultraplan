import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

const restores: Array<() => void> = []

function safeMockModule(tsPath: string, overrides: Record<string, unknown>) {
  const jsPath = tsPath.replace(/\.ts$/, '.js')
  const real = require(tsPath)
  const snapshot = { ...real }
  mock.module(jsPath, () => ({ ...snapshot, ...overrides }))
  restores.push(() => mock.module(jsPath, () => snapshot))
}

type SpawnCall = {
  sessionId: string
  opts: { cwd: string; resume?: boolean }
}

let spawnCalls: SpawnCall[] = []
let liveSessions: Array<{
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  name?: string
}> = []
let sessionInfos: Array<{
  sessionId: string
  summary: string
  lastModified: number
  cwd?: string
  customTitle?: string
}> = []

let pidCounter = 1000

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = ++pidCounter
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.killed) return true
    this.killed = true
    this.signalCode = signal
    queueMicrotask(() => {
      this.emit('close', this.exitCode, signal)
    })
    return true
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('close', code, signal)
  }
}

const spawnedChildren: FakeChild[] = []

safeMockModule('./processStarter.ts', {
  spawnSessionProcess: mock((sessionId: string, opts: { cwd: string; resume?: boolean }) => {
    spawnCalls.push({ sessionId, opts })
    const child = new FakeChild()
    spawnedChildren.push(child)
    return child
  }),
})

safeMockModule('./sessionRegistry.ts', {
  registerSession: mock(async () => {}),
  unregisterSession: mock(async () => {}),
  listLiveSessions: mock(async () => liveSessions),
})

safeMockModule('../utils/listSessionsImpl.ts', {
  listSessionsImpl: mock(async () => sessionInfos),
})

const { ProcessSessionManager } = await import('./sessionManager.js')

describe('ProcessSessionManager', () => {
  beforeEach(() => {
    spawnCalls = []
    liveSessions = []
    sessionInfos = []
    spawnedChildren.length = 0
  })

  test('resumes archived sessions with the transcript cwd', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    sessionInfos = [
      {
        sessionId,
        summary: 'Existing session',
        lastModified: Date.now(),
        cwd: '/archived/repo',
        customTitle: 'Existing title',
      },
    ]

    const manager = new ProcessSessionManager()
    manager.init({ capacity: 2 })

    const handle = await manager.getOrCreate(sessionId)

    expect(handle.sessionId).toBe(sessionId)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toEqual({
      sessionId,
      opts: {
        cwd: '/archived/repo',
        resume: true,
      },
    })

    await manager.destroyAll()
  })

  test('creates logical sessions before attaching a CLI runtime', async () => {
    const manager = new ProcessSessionManager()
    manager.init({ capacity: 2 })

    const session = await manager.createLogicalSession('/repo')

    expect(spawnCalls).toHaveLength(0)
    expect(session.cwd).toBe('/repo')
    expect(session.status).toBe('active')
    expect(await manager.getSessionMessages(session.id)).toEqual([])

    const handle = await manager.getOrCreate(session.id)

    expect(handle.sessionId).toBe(session.id)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toEqual({
      sessionId: session.id,
      opts: {
        cwd: '/repo',
        resume: false,
      },
    })

    await manager.destroyAll()
  })

  test('rejects sessions already active in another server process', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440001'
    liveSessions = [
      {
        pid: 4321,
        sessionId,
        cwd: '/live/repo',
        startedAt: Date.now(),
        kind: 'server',
      },
    ]

    const manager = new ProcessSessionManager()

    await expect(manager.getOrCreate(sessionId, '/repo')).rejects.toThrow(
      'already active in another server process',
    )
    expect(spawnCalls).toHaveLength(0)
  })

  test('propagates subprocess failures while keeping the queue reusable', async () => {
    const manager = new ProcessSessionManager()
    manager.init({ capacity: 2 })

    const handle = await manager.createSession(
      '550e8400-e29b-41d4-a716-446655440002',
      '/repo',
    )
    const child = spawnedChildren.at(-1)
    expect(child).toBeDefined()
    child?.stdin.on('data', () => {
      queueMicrotask(() => {
        child.close(1, null)
      })
    })

    await expect(handle.enqueueMessage('{"type":"user"}')).rejects.toThrow(
      'Claude CLI subprocess exited with code 1',
    )

    await manager.destroyAll()
  })

  test('treats CLI idle state as turn completion when result is missing', async () => {
    const manager = new ProcessSessionManager()
    manager.init({ capacity: 2 })

    const handle = await manager.createSession(
      '550e8400-e29b-41d4-a716-446655440003',
      '/repo',
    )
    const child = spawnedChildren.at(-1)
    expect(child).toBeDefined()

    child?.stdin.on('data', () => {
      queueMicrotask(() => {
        child.stdout.write(
          `${JSON.stringify({
            type: 'system',
            subtype: 'session_state_changed',
            state: 'running',
            session_id: handle.sessionId,
            uuid: 'state-running',
          })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'partial answer' }],
            },
          })}\n`,
        )
        child.stdout.write(
          `${JSON.stringify({
            type: 'system',
            subtype: 'session_state_changed',
            state: 'idle',
            session_id: handle.sessionId,
            uuid: 'state-idle',
          })}\n`,
        )
      })
    })

    await expect(handle.enqueueMessage('{"type":"user"}')).resolves.toBeUndefined()

    await manager.destroyAll()
  })

  test('interrupt sends the CLI control_request protocol', async () => {
    const manager = new ProcessSessionManager()
    manager.init({ capacity: 2 })

    const handle = await manager.createSession(
      '550e8400-e29b-41d4-a716-446655440004',
      '/repo',
    )
    const child = spawnedChildren.at(-1)
    expect(child).toBeDefined()

    const writes: string[] = []
    child?.stdin.on('data', (chunk) => {
      writes.push(chunk.toString())
    })

    handle.interrupt()

    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]!.trim())).toMatchObject({
      type: 'control_request',
      request: {
        subtype: 'interrupt',
      },
    })

    await manager.destroyAll()
  })
})

afterAll(() => {
  for (const restore of restores.reverse()) {
    restore()
  }
})
