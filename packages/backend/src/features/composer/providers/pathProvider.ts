import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { FileSuggestion } from '../types'
import { MAX_DIR_SCAN, MAX_PATH_RESULTS, PATH_MODE_PREFIXES } from '../types'

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

export function isPathLikeToken(query: string): boolean {
  if (!query) return false
  return PATH_MODE_PREFIXES.some((prefix) => query.startsWith(prefix))
}

function resolvePathToken(token: string, rootDir: string): { dir: string; prefix: string } {
  const expanded = token.startsWith('~/') ? join(process.env.HOME || rootDir, token.slice(2)) : token
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(rootDir, expanded)
  const tokenEndsWithSlash = token.endsWith('/')
  const baseDir = tokenEndsWithSlash ? absolute : dirname(absolute)
  const prefix = tokenEndsWithSlash ? '' : basename(absolute)
  return { dir: baseDir, prefix }
}

export async function pathModeSuggestions(token: string, rootDir: string): Promise<FileSuggestion[]> {
  const { dir, prefix } = resolvePathToken(token, rootDir)
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, MAX_DIR_SCAN)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_PATH_RESULTS)
      .map((entry) => {
        const absolutePath = join(dir, entry.name)
        const relativePathRaw = relative(rootDir, absolutePath)
        const relativePath = normalizePath(relativePathRaw || '.')
        const isDirectory = entry.isDirectory()
        return {
          id: `${isDirectory ? 'dir' : 'file'}-${relativePath}`,
          displayText: relativePath,
          insertText: isDirectory ? `${relativePath}/` : relativePath,
          type: isDirectory ? 'directory' : 'file',
          tag: 'local',
          description: isDirectory ? 'directory' : `${entry.name} · ${dirname(relativePath)}`,
        } satisfies FileSuggestion
      })
  } catch {
    return []
  }
}
