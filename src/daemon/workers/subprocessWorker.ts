import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js'
import type {
  HeartbeatInfo,
  Worker,
  WorkerConfig,
  WorkerControlSignal,
  WorkerHandle,
  WorkerLifecycleState,
} from '../../types/worker.js'

interface RunningWorker {
  handle: WorkerHandle
  child: ChildProcess
  startedAt: Date
  lastSeenAt: Date
  restartCount: number
  crashReason?: string
}

export class SubprocessWorker implements Worker {
  private readonly workers = new Map<string, RunningWorker>()

  spawn(config: WorkerConfig): WorkerHandle {
    const workerId = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const sessionId = config.sessionId

    const launch = buildCliLaunch(
      [
        '--print',
        '--session-id',
        sessionId,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
      ],
      {
        env: {
          ...process.env,
          CLAUDE_CODE_SESSION_KIND: 'worker',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'worker',
          ...(config.workspacePath && { CLAUDE_CODE_CWD: config.workspacePath }),
          ...(config.permission && { CLAUDE_CODE_PERMISSION_MODE: config.permission }),
        } as NodeJS.ProcessEnv,
      },
    )

    const child = spawnCli(launch, {
      cwd: config.workspacePath || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const handle: WorkerHandle = {
      workerId,
      sessionId,
      kind: 'subprocess',
    }

    const running: RunningWorker = {
      handle,
      child,
      startedAt: new Date(),
      lastSeenAt: new Date(),
      restartCount: 0,
    }

    this.watchChild(workerId, child, sessionId)
    this.workers.set(workerId, running)

    return handle
  }

  private watchChild(workerId: string, child: ChildProcess, sessionId: string): void {
    child.on('close', (code, signal) => {
      const running = this.workers.get(workerId)
      if (!running) return

      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        running.crashReason = 'terminated'
      } else if (code !== 0) {
        running.crashReason = `exited with code ${code}`
      }

      this.workers.delete(workerId)
    })

    child.on('error', (err) => {
      const running = this.workers.get(workerId)
      if (running) {
        running.crashReason = err.message
      }
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', () => {
        const running = this.workers.get(workerId)
        if (running) {
          running.lastSeenAt = new Date()
        }
      })
    }
  }

  sendInput(handle: WorkerHandle, input: unknown): void {
    const running = this.workers.get(handle.workerId)
    if (!running) return

    const data = typeof input === 'string' ? input : JSON.stringify(input)
    if (running.child.stdin && !running.child.stdin.destroyed) {
      running.child.stdin.write(data + '\n')
    }
  }

  sendControl(handle: WorkerHandle, signal: WorkerControlSignal): void {
    const running = this.workers.get(handle.workerId)
    if (!running) return

    switch (signal) {
      case 'interrupt':
        if (running.child.stdin && !running.child.stdin.destroyed) {
          running.child.stdin.write(
            JSON.stringify({
              type: 'control_request',
              request_id: crypto.randomUUID(),
              request: { subtype: 'interrupt' },
            }) + '\n',
          )
        }
        break
      case 'resume':
        if (running.child.stdin && !running.child.stdin.destroyed) {
          running.child.stdin.write(
            JSON.stringify({
              type: 'control_request',
              request_id: crypto.randomUUID(),
              request: { subtype: 'resume' },
            }) + '\n',
          )
        }
        break
      case 'cancel':
        if (!running.child.killed) {
          running.child.kill('SIGTERM')
        }
        break
    }
  }

  status(handle: WorkerHandle): WorkerLifecycleState {
    const running = this.workers.get(handle.workerId)
    if (!running) return 'stopped'

    if (running.child.exitCode !== null) {
      return running.child.exitCode === 0 ? 'stopped' : 'crashed'
    }

    if (running.crashReason) return 'crashed'

    return running.child.exitCode === null ? 'running' : 'stopped'
  }

  heartbeat(handle: WorkerHandle): HeartbeatInfo {
    const running = this.workers.get(handle.workerId)

    if (!running) {
      return {
        lastSeenAt: new Date(),
        restartCount: 0,
        crashReason: undefined,
        currentState: 'stopped',
      }
    }

    return {
      lastSeenAt: running.lastSeenAt,
      restartCount: running.restartCount,
      crashReason: running.crashReason,
      currentState: this.status(handle),
    }
  }

  shutdown(handle: WorkerHandle): void {
    const running = this.workers.get(handle.workerId)
    if (!running) return

    if (!running.child.killed) {
      running.child.kill('SIGTERM')
    }

    const timeout = setTimeout(() => {
      if (!running.child.killed && running.child.exitCode === null) {
        running.child.kill('SIGKILL')
      }
    }, 10_000)

    running.child.on('close', () => {
      clearTimeout(timeout)
    })

    this.workers.delete(handle.workerId)
  }
}