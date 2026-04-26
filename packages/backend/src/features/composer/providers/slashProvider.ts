import { suggestCommandsByQuery } from './commandProvider'
import type { SlashCommandResult } from '../types'

export async function executeSlashCommandByQuery(input: string, rootDir: string): Promise<SlashCommandResult> {
  const trimmed = input.trim()
  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const [cmd, ...rest] = normalized.split(/\s+/)
  const command = cmd?.toLowerCase() ?? ''
  const args = rest.join(' ').trim()

  switch (command) {
    case '':
      return { output: 'Please provide a slash command.' }
    case 'help': {
      const dynamic = await suggestCommandsByQuery('', rootDir)
      const lines = dynamic.map((item) =>
        `/${item.name}${item.argumentHint ? ` ${item.argumentHint}` : ''} — ${item.description}`,
      )
      return { output: lines.join('\n') || 'No commands available.' }
    }
    case 'clear':
      return {
        output: 'Conversation cleared.',
        clearConversation: true,
      }
    case 'model': {
      const model = process.env.ANTHROPIC_MODEL ?? process.env.CLAUDE_CODE_MODEL ?? 'default'
      const extra = args ? `\nargs: ${args}` : ''
      return { output: `Current model: ${model}${extra}` }
    }
    default: {
      const dynamic = await suggestCommandsByQuery(command, rootDir)
      const exact = dynamic.find((item) => item.name.toLowerCase() === command)
      if (exact) {
        return {
          output: `/${exact.name}${exact.argumentHint ? ` ${exact.argumentHint}` : ''}\n${exact.description}`,
        }
      }
      return {
        output: `Unknown command: /${command}. Try /help.`,
      }
    }
  }
}
