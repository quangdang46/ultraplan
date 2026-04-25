import { ChevronRight, CircleAlert, CircleCheck, Loader2, Wrench } from "lucide-react";
import type { ToolItem } from "./conversation.types";

type ConversationToolItemProps = {
  tool: ToolItem;
  isOpen: boolean;
  onToggle: () => void;
};

function getStatusTone(tool: ToolItem) {
  if (tool.status === "running") {
    return "border-[#f0b6b6] bg-[#fff4f4] text-[#b74040]";
  }

  if (tool.status === "failed") {
    return "border-[#efc9a3] bg-[#fff7ed] text-[#9a3412]";
  }

  return "border-border-warm bg-white text-near-black hover:bg-[#fcfbf8]";
}

function getStatusIcon(tool: ToolItem) {
  if (tool.status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }

  if (tool.status === "failed") {
    return <CircleAlert className="h-3.5 w-3.5" />;
  }

  return <CircleCheck className="h-3.5 w-3.5" />;
}

export const ConversationToolItem = ({ tool, isOpen, onToggle }: ConversationToolItemProps) => {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`group inline-flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-all ${getStatusTone(
          tool,
        )}`}
      >
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-warm-sand text-charcoal-warm">
            <Wrench className="h-3 w-3" />
          </span>
          <span className="font-mono-claude text-[12.5px] leading-tight">{tool.title}</span>
          <span className="rounded-[6px] border border-border-warm bg-white/70 px-1.5 py-px text-[10.5px] uppercase tracking-wide text-stone-gray">
            {tool.kind}
          </span>
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="text-stone-gray">{getStatusIcon(tool)}</span>
          <ChevronRight
            className={`h-4 w-4 flex-shrink-0 text-stone-gray transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </span>
      </button>

      {isOpen && (
        <div className="ml-3 space-y-2 rounded-[11px] border border-border-warm bg-white/75 px-3.5 py-2.5 text-[13px] leading-[1.6] text-charcoal-warm shadow-whisper backdrop-blur-[2px]">
          <p className="text-near-black">{tool.summary}</p>
          <div className="rounded-[9px] border border-border-warm bg-[#f8f7f3]/80 px-2.5 py-2 font-mono-claude text-[11.5px] leading-[1.55] text-dark-warm">
            {tool.output.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
