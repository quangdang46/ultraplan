// Standalone command suggestions for RCS (no CLI dependency)

import type { CommandSuggestion } from "./types.js";
import { STATIC_COMMAND_CATALOG, isCommandAvailable } from "../command/catalog.js";

export async function suggestCommandsByQuery(query: string, _rootDir: string): Promise<CommandSuggestion[]> {
  const normalizedQuery = query.trim().toLowerCase();

  const allCommands = STATIC_COMMAND_CATALOG
    .filter((cmd) => !cmd.isHidden)
    .filter((cmd) => isCommandAvailable(cmd))
    .map((cmd) => ({
      name: `/${cmd.name}`,
      description: cmd.description,
    }));

  if (!normalizedQuery) {
    return allCommands.sort((a, b) => a.name.localeCompare(b.name));
  }

  return allCommands
    .filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(normalizedQuery) ||
        cmd.description.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName === normalizedQuery) return -1;
      if (bName === normalizedQuery) return 1;
      if (aName.startsWith(normalizedQuery) && !bName.startsWith(normalizedQuery)) return -1;
      if (!aName.startsWith(normalizedQuery) && bName.startsWith(normalizedQuery)) return 1;
      return aName.localeCompare(bName);
    });
}