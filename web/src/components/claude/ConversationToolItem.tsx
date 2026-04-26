import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, Loader2, Wrench } from "lucide-react";
import type { ToolItem } from "./conversation.types";

type ConversationToolItemProps = {
  item: ToolItem;
};

function getStatusIcon(item: ToolItem) {
  if (item.status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (item.status === "failed") {
    return <CircleAlert className="h-3.5 w-3.5" />;
  }
  return <CircleCheck className="h-3.5 w-3.5" />;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.floor(ms / 100) / 10}s`;
  return `${Math.floor(ms / 100) / 10}s`;
}

export const ConversationToolItem = ({ item }: ConversationToolItemProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isRunning = item.status === "running";
  const isFailed = item.status === "failed";

  // Running state: "● Bash (command)" + "Running… (0:02)" + last 5 lines
  if (isRunning) {
    return (
      <div className="space-y-1.5">
        <div className="group inline-flex w-full items-center justify-between gap-3 rounded-[10px] border border-[#f0b6b6] bg-[#fff4f4] px-3 py-2 text-left transition-all">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-warm-sand text-charcoal-warm">
              <Wrench className="h-3 w-3" />
            </span>
            <span className="font-mono-claude text-[12.5px] leading-tight">{item.title}</span>
          </span>

          <span className="inline-flex items-center gap-2">
            <span className="text-stone-gray">{getStatusIcon(item)}</span>
          </span>
        </div>

        <div className="ml-3 rounded-[11px] border border-border-warm bg-white/75 px-3.5 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-stone-gray">
            <span>Running…</span>
            {item.elapsedMs && (
              <span className="font-mono">({formatElapsed(item.elapsedMs)})</span>
            )}
          </div>

          {item.outputLines && item.outputLines.length > 0 && (
            <div className="space-y-0.5 font-mono text-[11.5px] text-dark-warm">
              {item.outputLines.map((line, i) => (
                <div key={i} className="truncate">{line}</div>
              ))}
            </div>
          )}

          {/* Blinking cursor while running */}
          <div className="mt-2 font-mono text-[11px] text-stone-gray animate-pulse">▋</div>
        </div>
      </div>
    );
  }

  // Completed state: collapsible header
  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group inline-flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-all ${
          isFailed
            ? "border-[#efc9a3] bg-[#fff7ed] text-[#9a3412]"
            : "border-border-warm bg-white text-near-black hover:bg-[#fcfbf8]"
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] ${
            isFailed ? "bg-[#fed7aa] text-[#9a3412]" : "bg-warm-sand text-charcoal-warm"
          }`}>
            <Wrench className="h-3 w-3" />
          </span>
          <span className="font-mono-claude text-[12.5px] leading-tight">{item.title}</span>
        </span>

        <span className="inline-flex items-center gap-2">
          <span className={isFailed ? "text-[#9a3412]" : "text-stone-gray"}>
            {getStatusIcon(item)}
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="ml-3 space-y-2 rounded-[11px] border border-border-warm bg-white/75 px-3.5 py-2.5">
          {/* stdout */}
          {item.output && (
            <div className="font-mono text-[11.5px] leading-[1.55] text-dark-warm whitespace-pre-wrap">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.output}</ReactMarkdown>
            </div>
          )}

          {/* stderr (red) */}
          {item.stderr && (
            <div className="font-mono text-[11.5px] leading-[1.55] text-coral whitespace-pre-wrap">
              {item.stderr}
            </div>
          )}

          {/* CWD warning (amber) */}
          {item.cwdWarning && (
            <div className="font-mono text-[11.5px] leading-[1.55] text-amber-600">
              {item.cwdWarning}
            </div>
          )}

          {/* Time display */}
          {item.timeDisplay && (
            <div className="text-[11px] text-stone-gray">
              {item.timeDisplay}
            </div>
          )}
        </div>
      )}
    </div>
  );
};