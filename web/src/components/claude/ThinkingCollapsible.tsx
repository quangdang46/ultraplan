import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, Brain } from "lucide-react";

export function ThinkingCollapsible({
  thinking,
  streamingEndedAt,
}: {
  thinking: string;
  streamingEndedAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const preview = thinking.length > 120 ? `${thinking.slice(0, 120)}…` : thinking;

  useEffect(() => {
    if (!streamingEndedAt || !open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setOpen(false);
    }, 30000);

    return () => window.clearTimeout(timeout);
  }, [open, streamingEndedAt]);

  return (
    <div className="rounded-lg border border-[#eadfd6] bg-[#f8f2ed] text-charcoal-warm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#f3ebe4]"
      >
        <ChevronRight
          className={`h-3 w-3 text-[#8c6a5b] transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Brain className="h-3 w-3 text-[#8c6a5b]" />
        <span className="text-[10.5px] font-semibold tracking-wide text-[#8c6a5b]">
          Thinking
        </span>
        {!open && (
          <span className="ml-1 truncate text-[11px] text-stone-gray">{preview}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-[#eadfd6] px-3 py-2 text-xs leading-[1.55] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:whitespace-pre-wrap [&_code]:break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
