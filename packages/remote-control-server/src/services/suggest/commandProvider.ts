// Standalone command suggestions for RCS (no CLI dependency)

import type { CommandSuggestion } from './types.js'

const STATIC_COMMANDS: CommandSuggestion[] = [
  { name: '/compact', description: 'Summarize conversation to free context' },
  { name: '/model', description: 'Switch model (opus/sonnet/haiku)' },
  { name: '/export', description: 'Export conversation' },
  { name: '/help', description: 'Show help' },
  { name: '/clear', description: 'Clear conversation' },
  { name: '/memory', description: 'Manage memory files' },
  { name: '/mcp', description: 'Manage MCP servers' },
  { name: '/doctor', description: 'Run diagnostics' },
  { name: '/rewind', description: 'Undo last turn' },
  { name: '/cost', description: 'Show token usage and cost' },
  { name: '/permissions', description: 'Manage tool permissions' },
  { name: '/config', description: 'View or update configuration' },
  { name: '/status', description: 'Show session status' },
  { name: '/review', description: 'Review code changes' },
  { name: '/init', description: 'Initialize project CLAUDE.md' },
]

export async function suggestCommandsByQuery(query: string, _rootDir: string): Promise<CommandSuggestion[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return STATIC_COMMANDS

  return STATIC_COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(normalizedQuery) ||
      cmd.description.toLowerCase().includes(normalizedQuery),
  ).sort((a, b) => {
    const aName = a.name.toLowerCase()
    const bName = b.name.toLowerCase()
    if (aName === normalizedQuery) return -1
    if (bName === normalizedQuery) return 1
    if (aName.startsWith(normalizedQuery) && !bName.startsWith(normalizedQuery)) return -1
    if (!aName.startsWith(normalizedQuery) && bName.startsWith(normalizedQuery)) return 1
    return aName.localeCompare(bName)
  })
}
