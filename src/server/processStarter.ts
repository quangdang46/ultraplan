// src/server/processStarter.ts
// Spawn CLI subprocess for a session

import { type ChildProcess } from 'child_process'
import { buildCliLaunch, spawnCli } from '../utils/cliLaunch.js'
import type { SpawnOptions } from './types.js'

export function spawnSessionProcess(
  sessionId: string,
  opts: SpawnOptions
): ChildProcess {
  const args = [
    '--print',
    '--verbose',
    '--include-partial-messages',
    ...(opts.resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
  ]

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...opts.env,
    CLAUDE_CODE_SESSION_KIND: 'server',
    CLAUDE_CODE_ENVIRONMENT_KIND: 'server',
    // Server sessions need the CLI's authoritative idle/running events so
    // the web transport can detect real turn completion and interrupts.
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
  }

  if (opts.permissionMode) {
    env.CLAUDE_CODE_PERMISSION_MODE = opts.permissionMode
  }

  const launch = buildCliLaunch(args, { env })

  return spawnCli(launch, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
