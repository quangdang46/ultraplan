// Standalone command suggestions for RCS.
// Uses the shared command catalog so custom workspace commands, CLI-backed
// commands, aliases, and argument hints stay aligned with the CLI.

import type { CommandSuggestion } from "./types.js";
import {
  getVisibleCommandsForWorkspace,
  type CommandCatalogEntry,
} from "../command/catalog.js";

type SuggestionCandidate = CommandSuggestion;

function toSuggestion(
  name: string,
  cmd: CommandCatalogEntry,
  description = cmd.description,
): SuggestionCandidate {
  return {
    name,
    description,
    argumentHint: cmd.argumentHint,
  };
}

function toAliasSuggestion(
  alias: string,
  cmd: CommandCatalogEntry,
): SuggestionCandidate {
  return {
    name: alias,
    description: `Alias for /${cmd.name}. ${cmd.description}`,
    argumentHint: cmd.argumentHint,
  };
}

function filterAndSortSuggestions(
  items: SuggestionCandidate[],
  normalizedQuery: string,
): CommandSuggestion[] {
  const deduped = new Map<string, SuggestionCandidate>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()]
    .filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName === normalizedQuery;
      const bExact = bName === normalizedQuery;

      if (aExact !== bExact) {
        return aExact ? -1 : 1;
      }

      const aPrefix = aName.startsWith(normalizedQuery);
      const bPrefix = bName.startsWith(normalizedQuery);
      if (aPrefix !== bPrefix) {
        return aPrefix ? -1 : 1;
      }

      return aName.localeCompare(bName);
    })
    .map(({ name, description, argumentHint }) => ({
      name,
      description,
      argumentHint,
    }));
}

export async function suggestCommandsByQuery(
  query: string,
  rootDir: string,
): Promise<CommandSuggestion[]> {
  const normalizedQuery = query.trim().replace(/^\//, "").toLowerCase();
  const visibleCommands = await getVisibleCommandsForWorkspace(rootDir, false);

  const suggestions: SuggestionCandidate[] = visibleCommands.map((cmd) =>
    toSuggestion(cmd.name, cmd),
  );

  if (normalizedQuery) {
    suggestions.push(
      ...visibleCommands.flatMap((cmd) =>
        (cmd.aliases ?? [])
          .filter((alias) => alias !== cmd.name)
          .filter((alias) => alias.toLowerCase().includes(normalizedQuery))
          .map((alias) => toAliasSuggestion(alias, cmd)),
      ),
    );
  }

  return filterAndSortSuggestions(suggestions, normalizedQuery);
}
