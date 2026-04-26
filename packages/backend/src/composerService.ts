import { basename, dirname, join } from 'node:path'
import type {
  CommandSuggestion,
  FileSuggestion,
  FileSuggestionsResponse,
} from '../../contracts/src/index'
import { getFileIndex } from './features/composer/providers/fileIndexProvider'
import { suggestCommandsByQuery } from './features/composer/providers/commandProvider'
import { executeSlashCommandByQuery } from './features/composer/providers/slashProvider'
import { isPathLikeToken, pathModeSuggestions } from './features/composer/providers/pathProvider'
import { scoreFile } from './features/composer/providers/rankingProvider'
import { MAX_FILE_SUGGESTIONS, TOP_LEVEL_CAP, type SlashCommandResult, type SuggestFilesResult } from './features/composer/types'


function toFileSuggestion(path: string, score?: number): FileSuggestion {
  return {
    id: `file-${path}`,
    displayText: path,
    insertText: path,
    type: 'file',
    tag: 'local',
    description: `${basename(path)} · ${dirname(path)}`,
    score,
  }
}

function toAgentSuggestion(path: string, score?: number): FileSuggestion {
  const agentName = basename(path).replace(/\.md$/i, '')
  return {
    id: `agent-${agentName}`,
    displayText: `@${agentName}`,
    insertText: `@${agentName}`,
    type: 'agent',
    tag: 'agent',
    description: path,
    score,
  }
}

async function parseMcpServersAsync(rootDir: string): Promise<Array<{ name: string; path: string }>> {
  try {
    const mcpPath = join(rootDir, '.mcp.json')
    const content = await Bun.file(mcpPath).text()
    const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> }
    const names = Object.keys(parsed.mcpServers ?? {})
    return names.map((name) => ({ name, path: '.mcp.json' }))
  } catch {
    return []
  }
}

export async function suggestFiles(query: string, rootDir: string): Promise<SuggestFilesResult> {
  const fileIndex = await getFileIndex(rootDir)
  const trimmedQuery = query.trim()

  let items: FileSuggestion[]
  let capApplied = false
  let diagnostics: SuggestFilesResult['diagnostics'] | undefined
  if (isPathLikeToken(trimmedQuery)) {
    items = await pathModeSuggestions(trimmedQuery, rootDir)
  } else {
    const scored = fileIndex.mergedFiles
      .filter((file) => (trimmedQuery ? file.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))
      .map((file) => ({ file, score: scoreFile(file, trimmedQuery) }))
      .sort((a, b) => a.score - b.score || a.file.localeCompare(b.file))
    const fileItems = (trimmedQuery ? scored.slice(0, TOP_LEVEL_CAP) : scored.slice(0, TOP_LEVEL_CAP)).map(({ file, score }) =>
      toFileSuggestion(file, score),
    )

    const agentItems = fileIndex.mergedFiles
      .filter((path) => path.startsWith('.claude/agents/') && path.endsWith('.md'))
      .map((path) => toAgentSuggestion(path, scoreFile(path, trimmedQuery) + 25))
      .filter((item) => (trimmedQuery ? item.displayText.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))

    const mcpResources = await parseMcpServersAsync(rootDir)
    const mcpItems = mcpResources
      .map((resource) => ({
        id: `mcp-resource-${resource.name}`,
        displayText: `${resource.name}:${resource.path}`,
        insertText: `${resource.name}:${resource.path}`,
        type: 'mcp-resource' as const,
        tag: 'mcp',
        description: 'MCP resource',
        score: scoreFile(resource.name, trimmedQuery) + 35,
      }))
      .filter((item) => (trimmedQuery ? item.displayText.toLowerCase().includes(trimmedQuery.toLowerCase()) : true))

    const merged = [...fileItems, ...agentItems, ...mcpItems]
      .sort((a, b) => (a.score ?? 1000) - (b.score ?? 1000) || a.displayText.localeCompare(b.displayText))
    const visibleLimit = trimmedQuery ? MAX_FILE_SUGGESTIONS : merged.length
    capApplied = merged.length > visibleLimit
    items = merged.slice(0, visibleLimit)
    diagnostics = {
      totalFiles: fileItems.length,
      totalAgents: agentItems.length,
      totalMcpResources: mcpItems.length,
    }
  }

  return {
    items,
    isPartial: fileIndex.isPartial,
    generation: fileIndex.generation,
    capApplied,
    diagnostics,
  }
}

export async function suggestCommands(query: string, rootDir: string): Promise<CommandSuggestion[]> {
  return suggestCommandsByQuery(query, rootDir)
}

export async function executeSlashCommand(input: string, rootDir: string): Promise<SlashCommandResult> {
  return executeSlashCommandByQuery(input, rootDir)
}

