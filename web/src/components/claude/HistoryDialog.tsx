import { useEffect, useRef, useState } from "react";
import { Search, Clock, X } from "lucide-react";
import { getApiClient } from "../../api/client";
import { formatDistanceToNow } from "date-fns";

interface PromptEntry {
  text: string;
  sessionId: string;
  timestamp: string;
}

type Props = {
  onSelect?: (text: string) => void;
  onClose: () => void;
};

export function HistoryDialog({ onSelect, onClose }: Props) {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const client = getApiClient();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const data = await client.getHistory(200);
        if (!cancelled) setPrompts(data.prompts);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const filtered = query.trim()
    ? prompts.filter((p) =>
        p.text.toLowerCase().includes(query.toLowerCase())
      )
    : prompts;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-xl bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[75vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-cream">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-near-black">
            <Clock className="w-4 h-4 text-stone-gray" />
            Prompt History
          </div>
          <button
            onClick={onClose}
            className="text-stone-gray hover:text-charcoal-warm transition-colors"
            aria-label="Close history"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-border-cream">
          <div className="flex items-center gap-2 bg-warm-sand rounded-lg px-3 py-1.5">
            <Search className="w-3.5 h-3.5 text-stone-gray flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search past prompts…"
              className="flex-1 bg-transparent text-[12.5px] text-olive-gray outline-none placeholder:text-stone-gray"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-stone-gray hover:text-charcoal-warm"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-warm-thin">
          {loading && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">
              Loading history…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">
              {query ? "No matching prompts" : "No prompt history yet"}
            </div>
          )}
          {!loading &&
            filtered.map((entry, idx) => (
              <button
                key={`${entry.timestamp}-${idx}`}
                onClick={() => {
                  onSelect?.(entry.text);
                  onClose();
                }}
                className="w-full text-left px-4 py-3 border-b border-border-cream last:border-b-0 hover:bg-warm-sand/60 transition-colors group"
              >
                <div className="text-[12.5px] text-near-black leading-relaxed line-clamp-2 group-hover:text-near-black">
                  {entry.text}
                </div>
                <div className="text-[10.5px] text-stone-gray mt-0.5">
                  {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
