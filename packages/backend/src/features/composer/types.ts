import type { CommandSuggestion, FileSuggestion, FileSuggestionsResponse } from '../../../contracts/src/index'

export type { CommandSuggestion, FileSuggestion }

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
