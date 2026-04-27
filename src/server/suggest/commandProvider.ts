// src/server/suggest/commandProvider.ts
// Command suggestions from CLI commands

import { enableConfigs } from '../../utils/config.js'
import { getCommands, getCommandName } from '../../commands.js'
import type { CommandSuggestion } from './types.js'

const COMMAND_CACHE_TTL_MS = 10_000
const commandCacheByRoot = new Map<string, { at: number; items: CommandSuggestion[] }>()

export async function suggestCommandsByQuery(query: string, rootDir: string): Promise<CommandSuggestion[]> {
  // Initialize config system (for isHidden checks)
  enableConfigs()

  const now = Date.now()
  const cached = commandCacheByRoot.get(rootDir)
  if (cached && now - cached.at < COMMAND_CACHE_TTL_MS && cached.items.length > 0) {
    const normalizedQuery = query.trim().toLowerCase()
    return filterCommands(cached.items, normalizedQuery)
  }

  try {
    const commands = await getCommands(rootDir)
    const map = new Map<string, CommandSuggestion>()
    for (const cmd of commands) {
      if (cmd?.isHidden) continue
      const name = getCommandName(cmd)
      if (!name) continue
      const argumentHint =
        cmd.argumentHint ||
        (cmd.type === 'prompt' && Array.isArray(cmd.argNames) && cmd.argNames.length > 0
          ? cmd.argNames.map((arg: string) => `<${arg}>`).join(' ')
          : undefined)
      if (!map.has(name)) {
        map.set(name, {
          name,
          description: cmd.description ?? '',
          argumentHint,
        })
      }
    }

    const items = [...map.values()]
    commandCacheByRoot.set(rootDir, { at: now, items })
    return filterCommands(items, query.trim().toLowerCase())
  } catch {
    commandCacheByRoot.set(rootDir, { at: now, items: [] })
    return []
  }
}

function filterCommands(items: CommandSuggestion[], normalizedQuery: string): CommandSuggestion[] {
  return items
    .filter((command) => {
      if (!normalizedQuery) return true
      return (
        command.name.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery)
      )
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const aExact = aName === normalizedQuery
      const bExact = bName === normalizedQuery
      if (aExact !== bExact) return aExact ? -1 : 1
      const aPrefix = aName.startsWith(normalizedQuery)
      const bPrefix = bName.startsWith(normalizedQuery)
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1
      return aName.localeCompare(bName)
    })
}