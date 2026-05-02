import { useEffect, useRef, useState } from "react";
import { Search, FileText, X } from "lucide-react";
import { getApiClient } from "../../api/client";

interface SearchResult {
  file: string;
  line: number;
  col?: number;
  text: string;
  matchStart?: number;
  matchEnd?: number;
}

type Props = {
  cwd?: string | null;
  sessionId?: string | null;
  onSelect?: (ref: string) => void;
  onClose: () => void;
};

function HighlightLine({
  text,
  matchStart,
  matchEnd,
}: {
  text: string;
  matchStart?: number;
  matchEnd?: number;
}) {
  if (matchStart === undefined || matchEnd === undefined) {
    return <span>{text}</span>;
  }
  return (
    <>
      <span>{text.slice(0, matchStart)}</span>
      <mark className="bg-terracotta/20 text-near-black rounded px-0.5">
        {text.slice(matchStart, matchEnd)}
      </mark>
      <span>{text.slice(matchEnd)}</span>
    </>
  );
}

export function SearchDialog({ cwd, sessionId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
        try {
          const client = getApiClient();
          const data = await client.searchWorkspace(
            q,
            50,
            cwd ?? undefined,
            sessionId ?? undefined,
          );
          if (!cancelled) setResults(data.results ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cwd, query, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-2xl bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-cream">
          <Search className="w-4 h-4 text-stone-gray flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspace (Ctrl+Shift+F)…"
            className="flex-1 bg-transparent text-[13px] text-olive-gray outline-none placeholder:text-stone-gray"
          />
          {loading && (
            <span className="text-[11px] text-stone-gray flex-shrink-0">
              Searching…
            </span>
          )}
          <button
            onClick={onClose}
            className="text-stone-gray hover:text-charcoal-warm transition-colors flex-shrink-0"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto scrollbar-warm-thin">
          {error && (
            <div className="px-4 py-4 text-[12px] text-red-600">
              {error}
            </div>
          )}
          {!error && !loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">
              No results for "{query}"
            </div>
          )}
          {!error && !query.trim() && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">
              Type to search files…
            </div>
          )}
          {results.map((result, idx) => {
            const ref = `@${result.file}#L${result.line}`;
            const displayText = result.text.replace(/\r?\n$/, "");
            return (
              <button
                key={`${result.file}:${result.line}-${idx}`}
                onClick={() => {
                  onSelect?.(ref);
                  onClose();
                }}
                className="w-full text-left px-4 py-2.5 border-b border-border-cream last:border-b-0 hover:bg-warm-sand/60 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <FileText className="w-3 h-3 text-stone-gray flex-shrink-0" />
                  <span className="text-[11.5px] font-mono text-terracotta truncate">
                    {result.file}
                  </span>
                  <span className="text-[10.5px] text-stone-gray flex-shrink-0">
                    :{result.line}
                  </span>
                </div>
                <div className="overflow-hidden pl-5 font-mono text-[11.5px] text-olive-gray whitespace-pre text-ellipsis">
                  <HighlightLine
                    text={displayText}
                    matchStart={result.matchStart}
                    matchEnd={result.matchEnd}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border-cream text-[10.5px] text-stone-gray">
            {results.length} result{results.length !== 1 ? "s" : ""}
            {results.length >= 50 ? " (limit reached)" : ""}
            · Click to insert @file#Lline reference
          </div>
        )}
      </div>
    </div>
  );
}
