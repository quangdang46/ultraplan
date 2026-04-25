import type { Command } from '../../commands.js'

const connect = {
  type: 'local',
  name: 'connect',
  description: 'Print connection info for web UI',
  supportsNonInteractive: true,
  load: () => import('./connect'),
} satisfies Command

export default connect