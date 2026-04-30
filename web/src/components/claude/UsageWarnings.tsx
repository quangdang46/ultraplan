import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { getApiClient } from "../../api/client";
import { ensureApiAuthenticated } from "../../features/chat/streamTransport";

interface Warning {
  id: string;
  message: string;
  type: "rate-limit" | "context";
}

const RATE_LIMIT_THRESHOLD = 80;
const CONTEXT_THRESHOLD = 80;
const POLL_INTERVAL = 30_000;
const AUTO_HIDE_DELAY = 5_000;

interface Props {
  sessionId?: string | null;
}

export function UsageWarnings({ sessionId }: Props) {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const client = getApiClient();
    let cancelled = false;

    const check = async () => {
      await ensureApiAuthenticated(client);
      let contextPct: number | null = null;

      try {
        const [usage, contextData] = await Promise.all([
          client.getUsage(),
          sessionId
            ? client.getContext(sessionId).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        contextPct = contextData?.usedPct ?? null;

        const newWarnings: Warning[] = [];

        // Rate limit warning
        if (usage.rateLimit.sessionPct > RATE_LIMIT_THRESHOLD) {
          newWarnings.push({
            id: "rate-limit",
            message: `Rate limit at ${usage.rateLimit.sessionPct}% (threshold: ${RATE_LIMIT_THRESHOLD}%)`,
            type: "rate-limit",
          });
        }

        // Context window warning
        if (contextPct !== null && contextPct > CONTEXT_THRESHOLD) {
          newWarnings.push({
            id: "context",
            message: `Context window at ${contextPct}% (threshold: ${CONTEXT_THRESHOLD}%)`,
            type: "context",
          });
        }

        if (!cancelled) {
          setWarnings((prev) => {
            const activeIds = new Set(newWarnings.map((w) => w.id));
            // Keep warnings that are still active and not already scheduled to hide
            const keep = prev.filter(
              (w) => !activeIds.has(w.id) && !timerRefs.current.has(w.id)
            );
            return [...keep, ...newWarnings];
          });

          // Auto-hide new warnings after delay
          for (const w of newWarnings) {
            if (!timerRefs.current.has(w.id)) {
              const timer = setTimeout(() => {
                setWarnings((prev) => prev.filter((x) => x.id !== w.id));
                timerRefs.current.delete(w.id);
              }, AUTO_HIDE_DELAY);
              timerRefs.current.set(w.id, timer);
            }
          }
        }
      } catch {
        // ignore polling errors silently
      }
    };

    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const t of timerRefs.current.values()) clearTimeout(t);
      timerRefs.current.clear();
    };
  }, [sessionId]);

  function dismiss(id: string) {
    const timer = timerRefs.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerRefs.current.delete(id);
    }
    setWarnings((prev) => prev.filter((w) => w.id !== id));
  }

  if (warnings.length === 0) return null;

  return (
    <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-shrink-0">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
        {warnings.map((w) => (
          <span
            key={w.id}
            className="text-[11.5px] text-amber-700 flex items-center gap-1"
          >
            {w.message}
            <button
              onClick={() => dismiss(w.id)}
              className="ml-0.5 text-amber-500 hover:text-amber-700 transition-colors"
              aria-label="Dismiss warning"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
