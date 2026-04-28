import { appendFile, mkdir, readdir, readFile, stat } from 'fs/promises'
import * as os from 'os'
import { dirname, join } from 'path'
import type { SessionMessage } from '../../packages/contracts/src/index.js'
import { getProjectDir } from '../utils/sessionStoragePortable.js'

const HOME_DIR = process.env.HOME ?? os.homedir()
const PROJECTS_DIR = join(HOME_DIR, '.claude', 'projects')

export async function resolveTranscriptPath(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const existingPath = await findExistingTranscriptPath(sessionId, cwd)
  if (existingPath) return existingPath

  if (cwd) {
    return join(getProjectDir(cwd), `${sessionId}.jsonl`)
  }

  return null
}

export async function findExistingTranscriptPath(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const candidatePaths: string[] = []

  if (cwd) {
    candidatePaths.push(join(getProjectDir(cwd), `${sessionId}.jsonl`))
  }

  let projectDirs: string[] = []
  try {
    projectDirs = await readdir(PROJECTS_DIR)
  } catch {
    projectDirs = []
  }

  for (const dir of projectDirs) {
    candidatePaths.push(join(PROJECTS_DIR, dir, `${sessionId}.jsonl`))
  }

  for (const candidatePath of candidatePaths) {
    try {
      const file = await stat(candidatePath)
      if (file.isFile()) return candidatePath
    } catch {
      // try next candidate
    }
  }

  return null
}

export async function appendSessionCustomTitle(
  sessionId: string,
  name: string,
  cwd?: string,
): Promise<boolean> {
  const transcriptPath = await resolveTranscriptPath(sessionId, cwd)
  if (!transcriptPath) return false

  await mkdir(dirname(transcriptPath), { recursive: true })
  await appendFile(
    transcriptPath,
    `${JSON.stringify({
      type: 'custom-title',
      customTitle: name,
      sessionId,
    })}\n`,
    'utf8',
  )

  return true
}

export async function loadTranscriptMessages(
  sessionId: string,
  cwd?: string,
): Promise<SessionMessage[]> {
  const transcriptPath = await resolveTranscriptPath(sessionId, cwd)
  if (!transcriptPath) return []

  try {
    const content = await readFile(transcriptPath, 'utf8')
    const lines = content.split('\n').filter((line) => line.trim())
    const messages: SessionMessage[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        const role =
          entry.type === 'user'
            ? 'user'
            : entry.type === 'assistant'
              ? 'assistant'
              : entry.type === 'system'
                ? 'system'
                : null
        if (!role) continue

        const blocks = extractBlocks(entry)
        const text = extractText(entry, blocks)
        if (!text && blocks.length === 0) continue

        messages.push({
          role,
          content: text,
          ...(blocks.length > 0 ? { blocks } : {}),
          timestamp:
            typeof entry.timestamp === 'string'
              ? entry.timestamp
              : new Date().toISOString(),
        })
      } catch {
        // skip malformed lines
      }
    }

    return messages
  } catch {
    return []
  }
}

function extractText(
  entry: Record<string, unknown>,
  blocks: NonNullable<SessionMessage['blocks']>,
): string {
  const direct = typeof entry.message === 'string'
    ? entry.message
    : typeof entry.content === 'string'
      ? entry.content
      : typeof entry.text === 'string'
        ? entry.text
        : null
  if (direct) return direct.trim()

  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractBlocks(
  entry: Record<string, unknown>,
): NonNullable<SessionMessage['blocks']> {
  const msg = entry.message as Record<string, unknown> | undefined
  const rawContent = Array.isArray(msg?.content)
    ? msg.content
    : Array.isArray(entry.content)
      ? entry.content
      : undefined

  if (!rawContent) {
    const direct = typeof entry.message === 'string'
      ? entry.message
      : typeof entry.content === 'string'
        ? entry.content
        : typeof entry.text === 'string'
          ? entry.text
          : null
    return direct?.trim()
      ? [{ type: 'text', text: direct.trim() }]
      : []
  }

  const blocks: NonNullable<SessionMessage['blocks']> = []
  for (const block of rawContent) {
    if (!block || typeof block !== 'object') continue
    const obj = block as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string' && obj.text.trim()) {
      blocks.push({ type: 'text', text: obj.text.trim() })
      continue
    }
    if (
      obj.type === 'thinking' &&
      typeof obj.thinking === 'string' &&
      obj.thinking.trim()
    ) {
      blocks.push({ type: 'thinking', thinking: obj.thinking.trim() })
      continue
    }
    if (obj.type === 'redacted_thinking') {
      blocks.push({
        type: 'redacted_thinking',
        summary: 'Redacted thinking omitted from transcript',
      })
      continue
    }
    if (obj.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: typeof obj.id === 'string' ? obj.id : undefined,
        name: typeof obj.name === 'string' ? obj.name : undefined,
        input:
          obj.input && typeof obj.input === 'object'
            ? (obj.input as Record<string, unknown>)
            : {},
      })
      continue
    }
    if (obj.type === 'tool_result') {
      const content = normalizeToolText(obj.content ?? obj.text)
      blocks.push({
        type: 'tool_result',
        tool_use_id:
          typeof obj.tool_use_id === 'string'
            ? obj.tool_use_id
            : typeof obj.id === 'string'
              ? obj.id
              : undefined,
        content,
        is_error: Boolean(obj.is_error),
      })
      continue
    }

    const structuredBlock = summarizeStructuredBlock(obj)
    if (structuredBlock) {
      blocks.push(structuredBlock)
    }
  }

  return blocks
}

function pickString(
  value: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!value) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function humanizeBlockType(type: string): string {
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function summarizeStructuredContentItem(item: Record<string, unknown>): string {
  const type = typeof item.type === 'string' ? item.type : 'content'
  const source =
    item.source && typeof item.source === 'object'
      ? (item.source as Record<string, unknown>)
      : undefined

  switch (type) {
    case 'text':
      return typeof item.text === 'string' ? item.text.trim() : ''
    case 'image': {
      const mimeType = pickString(source, ['media_type', 'mime_type'])
      return mimeType
        ? `[Image attachment: ${mimeType}]`
        : '[Image attachment]'
    }
    case 'document': {
      const title =
        pickString(source, ['filename']) ||
        pickString(item, ['title', 'filename', 'name'])
      return title ? `[Document: ${title}]` : '[Document attachment]'
    }
    case 'search_result':
    case 'web_search_result': {
      const title = pickString(item, ['title', 'name'])
      const url = pickString(item, ['url', 'uri'])
      if (title && url) return `${title} (${url})`
      if (title) return title
      if (url) return url
      return '[Search result]'
    }
    case 'web_fetch_result': {
      const url = pickString(item, ['url', 'uri'])
      return url ? `Fetched: ${url}` : '[Fetched content]'
    }
    case 'redacted_thinking':
      return '[Redacted thinking]'
    default: {
      const preview =
        pickString(item, ['text', 'title', 'name', 'url', 'uri']) ||
        pickString(source, ['filename', 'url'])
      return preview
        ? `[${humanizeBlockType(type)}: ${preview}]`
        : `[${humanizeBlockType(type)}]`
    }
  }
}

function summarizeStructuredBlock(
  obj: Record<string, unknown>,
): NonNullable<SessionMessage['blocks']>[number] | null {
  const type = typeof obj.type === 'string' ? obj.type : null
  if (!type) return null
  if (['text', 'thinking', 'tool_use', 'tool_result'].includes(type)) {
    return null
  }

  const source =
    obj.source && typeof obj.source === 'object'
      ? (obj.source as Record<string, unknown>)
      : undefined
  const title =
    pickString(obj, ['title', 'name', 'filename']) ||
    pickString(source, ['filename'])
  const url = pickString(obj, ['url', 'uri']) || pickString(source, ['url'])
  const mimeType =
    pickString(source, ['media_type', 'mime_type']) ||
    pickString(obj, ['mimeType', 'mediaType'])
  const sourceType = pickString(source, ['type'])

  let summary: string | undefined
  switch (type) {
    case 'image':
      summary = 'Image attachment'
      break
    case 'document':
      summary = title ? `Document: ${title}` : 'Document attachment'
      break
    case 'search_result':
    case 'web_search_result':
      summary =
        pickString(obj, ['snippet', 'description', 'text']) ||
        url ||
        'Search result'
      break
    case 'web_fetch_result':
      summary = url ? `Fetched: ${url}` : 'Fetched content'
      break
    case 'container_upload':
      summary = 'Container upload'
      break
    default:
      summary = summarizeStructuredContentItem(obj)
      break
  }

  return {
    type,
    ...(summary ? { summary } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(sourceType ? { sourceType } : {}),
  }
}

function normalizeToolText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (!raw) return ''

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        if (record.content !== undefined) return normalizeToolText(record.content)
        return summarizeStructuredContentItem(record)
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (typeof record.text === 'string') return record.text.trim()
    if (record.content !== undefined) return normalizeToolText(record.content)
    return summarizeStructuredContentItem(record)
  }

  return String(raw).trim()
}
