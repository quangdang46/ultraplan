import type { CommandSuggestion } from '../types'

const COMMAND_CACHE_TTL_MS = 10_000
const commandCacheByRoot = new Map<string, { at: number; items: CommandSuggestion[] }>()

async function loadDynamicCommands(rootDir: string): Promise<CommandSuggestion[]> {
  const now = Date.now()
  const cached = commandCacheByRoot.get(rootDir)
  if (cached && now - cached.at < COMMAND_CACHE_TTL_MS && cached.items.length > 0) {
    return cached.items
  }

  try {
    const configModule = await import('src/utils/config.js')
    configModule.enableConfigs()
    const commandsModule = await import('src/commands.js')
    const commands = await commandsModule.getCommands(rootDir)
    const map = new Map<string, CommandSuggestion>()
    for (const cmd of commands) {
      if (cmd?.isHidden) continue
      const name = commandsModule.getCommandName(cmd)
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
    return items
  } catch {
    commandCacheByRoot.set(rootDir, { at: now, items: [] })
    return []
  }
}

export async function suggestCommandsByQuery(query: string, rootDir: string): Promise<CommandSuggestion[]> {
  const source = await loadDynamicCommands(rootDir)
  const normalizedQuery = query.trim().toLowerCase()
  return source
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
