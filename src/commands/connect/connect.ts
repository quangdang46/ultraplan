import { randomUUID } from 'crypto'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  const port = parseInt(process.env.CLAUDE_CODE_SERVER_PORT || '8080')
  const connectionToken = randomUUID().slice(0, 8)

  return {
    type: 'text' as const,
    value: `🔌 Ultraplan Web UI Connection

Start server first:
  claude --server --port=${port}

Then open https://ultraplan.vercel.app and enter:
  Token: ${connectionToken}
  Port:  ${port}
`,
  }
}
