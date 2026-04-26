type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function getLevel(): LogLevel {
  const raw = (process.env.BACKEND_LOG_LEVEL ?? 'info').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const configured = getLevel()
  if (priority[level] < priority[configured]) return
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: 'backend',
    event,
    ...fields,
  }
  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }
}
