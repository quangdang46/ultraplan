export type ComposerSuggestionType = 'file' | 'directory' | 'agent' | 'mcp-resource' | 'command'

export type FileSuggestion = {
  id: string
  displayText: string
  insertText: string
  type: ComposerSuggestionType
  tag?: string
  description?: string
  score?: number
  path?: string
}

export type CommandSuggestion = {
  name: string
  description: string
  argumentHint?: string
}

export type FileSuggestionsResponse = {
  items: FileSuggestion[]
  isPartial?: boolean
  generation?: number
  capApplied?: boolean
  diagnostics?: {
    totalFiles: number
    totalAgents: number
    totalMcpResources: number
  }
}

export type CommandSuggestionsResponse = {
  items: CommandSuggestion[]
}

export type ExecuteCommandRequest = {
  command: string
}

export type ExecuteCommandResponse = {
  output: string
  clearConversation?: boolean
}
