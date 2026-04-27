// src/server/suggest/types.ts
// Suggestion types

export type CommandSuggestion = {
  name: string
  description: string
  argumentHint?: string
}

export type FileSuggestion = {
  id: string
  displayText: string
  insertText: string
  type: 'file' | 'directory' | 'agent' | 'mcp-resource'
  tag?: string
  description: string
  score?: number
}

export type FileSuggestionsResponse = {
  items: FileSuggestion[]
  isPartial: boolean
  generation: number
  capApplied?: boolean
  diagnostics?: {
    totalFiles: number
    totalAgents: number
    totalMcpResources: number
  }
}

export type SuggestFilesResult = FileSuggestionsResponse

export type SlashCommandResult = {
  output: string
  clearConversation?: boolean
}

export const TOP_LEVEL_CAP = 100
export const MAX_FILE_SUGGESTIONS = 15
export const MAX_PATH_RESULTS = 10
export const MAX_DIR_SCAN = 120
export const PATH_MODE_PREFIXES = ['~/', './', '../', '/', '~', '.', '..']