import { useEffect, useState } from "react";
import { BarChart2, X } from "lucide-react";
import { getApiClient } from "../../api/client";

interface ContextBreakdown {
  category: string;
  tokens: number;
  pct: number;
}

interface ContextData {
  maxTokens: number;
  totalInput: number;
  totalOutput: number;
  breakdown: ContextBreakdown[];
  usedPct: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  "System prompt": "#8b7355",
  "User messages": "#5769F7",
  "Assistant": "#D77757",
  "Tool results": "#7ec47a",
};

type Props = {
  sessionId?: string | null;
  onClose?: () => void;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ContextBar({ sessionId, onClose }: Props) {
  const [data, setData] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const client = getApiClient();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const resp = await client.getContext(sessionId);
        if (!cancelled) setData(resp);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const iv = setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <div className="border-t border-border-cream bg-parchment px-4 py-3 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-charcoal-warm">
          <BarChart2 className="w-3.5 h-3.5" />
          Context Window
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[10.5px] text-stone-gray">
              {formatTokens(data.totalInput)} / {formatTokens(data.maxTokens)} tokens
              ({data.usedPct}%)
            </span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-stone-gray hover:text-charcoal-warm transition-colors"
              aria-label="Close context bar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading && !data && (
        <div className="text-[11px] text-stone-gray">Loading…</div>
      )}

      {data && (
        <>
          {/* Stacked bar */}
          <div className="h-3 w-full rounded-full overflow-hidden flex bg-warm-sand/60 mb-2.5">
            {data.breakdown.map((item) =>
              item.pct > 0 ? (
                <div
                  key={item.category}
                  style={{
                    width: `${item.pct}%`,
                    backgroundColor: CATEGORY_COLORS[item.category] ?? "#ccc",
                  }}
                  title={`${item.category}: ${formatTokens(item.tokens)} (${item.pct}%)`}
                  className="transition-all"
                />
              ) : null
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {data.breakdown.map((item) => (
              <div key={item.category} className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? "#ccc" }}
                />
                <span className="text-[10.5px] text-stone-gray">
                  {item.category}
                </span>
                <span className="text-[10.5px] text-charcoal-warm font-medium">
                  {formatTokens(item.tokens)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
