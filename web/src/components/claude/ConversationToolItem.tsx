import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, Loader2, Wrench, FileEdit, Terminal, Globe, FileText } from "lucide-react";
import type { ToolItem } from "./conversation.types";

type ConversationToolItemProps = {
  item: ToolItem;
};

function getStatusIcon(item: ToolItem) {
  if (item.status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (item.status === "failed") return <CircleAlert className="h-3.5 w-3.5" />;
  return <CircleCheck className="h-3.5 w-3.5" />;
}

function getToolIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("bash") || k.includes("shell") || k.includes("repl")) return <Terminal className="h-3 w-3" />;
  if (k.includes("edit") || k.includes("write")) return <FileEdit className="h-3 w-3" />;
  if (k.includes("read") || k.includes("glob") || k.includes("grep")) return <FileText className="h-3 w-3" />;
  if (k.includes("web") || k.includes("fetch") || k.includes("search")) return <Globe className="h-3 w-3" />;
  return <Wrench className="h-3 w-3" />;
}

function formatElapsed(ms: number): string {
  return `${Math.floor(ms / 100) / 10}s`;
}

function getToolColor(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("bash") || k.includes("shell") || k.includes("repl")) {
    return {
      border: "border-amber-200",
      bg: "bg-amber-50",
      iconBg: "bg-amber-100",
      iconText: "text-amber-800",
    };
  }
  if (k.includes("edit") || k.includes("write")) {
    return {
      border: "border-purple-200",
      bg: "bg-purple-50",
      iconBg: "bg-purple-100",
      iconText: "text-purple-800",
    };
  }
  if (k.includes("read") || k.includes("glob") || k.includes("grep")) {
    return {
      border: "border-cyan-200",
      bg: "bg-cyan-50",
      iconBg: "bg-cyan-100",
      iconText: "text-cyan-800",
    };
  }
  if (k.includes("web") || k.includes("fetch") || k.includes("search")) {
    return {
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      iconBg: "bg-emerald-100",
      iconText: "text-emerald-800",
    };
  }
  return {
    border: "border-border-warm",
    bg: "bg-white",
    iconBg: "bg-warm-sand",
    iconText: "text-charcoal-warm",
  };
}

function DiffViewer({ output }: { output: string }) {
  const lines = output.split('\n');
  const isDiff = lines.some(l => l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@'));
  if (!isDiff) {
    return (
      <div className="font-mono text-[11.5px] leading-[1.55] text-dark-warm whitespace-pre-wrap break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] leading-[1.6] overflow-x-auto">
      {lines.map((line, i) => {
        let cls = "text-dark-warm";
        if (line.startsWith('+') && !line.startsWith('+++')) cls = "bg-[#e6ffed] text-[#1a7f37]";
        else if (line.startsWith('-') && !line.startsWith('---')) cls = "bg-[#ffebe9] text-[#cf222e]";
        else if (line.startsWith('@@')) cls = "bg-[#ddf4ff] text-[#0550ae]";
        else if (line.startsWith('+++') || line.startsWith('---')) cls = "text-stone-gray font-semibold";
        return (
          <div key={i} className={`px-2 whitespace-pre ${cls}`}>{line || ' '}</div>
        );
      })}
    </div>
  );
}

export const ConversationToolItem = ({ item }: ConversationToolItemProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isRunning = item.status === "running";
  const isFailed = item.status === "failed";
  const hasDetails = Boolean(item.output || item.stderr || item.cwdWarning || item.timeDisplay);
  const isFileOp = item.kind?.toLowerCase().includes('edit') || item.kind?.toLowerCase().includes('write');
  const color = getToolColor(item.kind);

  if (isRunning) {
    return (
      <div className="space-y-1.5">
        <div className={`group inline-flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-all ${color.border} ${color.bg}`}>
          <span className="inline-flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] ${color.iconBg} ${color.iconText}`}>
              {getToolIcon(item.kind)}
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
          <div className="mt-2 font-mono text-[11px] text-stone-gray animate-pulse">▋</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group inline-flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-all ${
          isFailed
            ? "border-[#efc9a3] bg-[#fff7ed] text-[#9a3412]"
            : `${color.border} ${color.bg} text-near-black hover:brightness-[0.99]`
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] ${
            isFailed ? "bg-[#fed7aa] text-[#9a3412]" : `${color.iconBg} ${color.iconText}`
          }`}>
            {getToolIcon(item.kind)}
          </span>
          <span className="font-mono-claude text-[12.5px] leading-tight">{item.title}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={isFailed ? "text-[#9a3412]" : "text-stone-gray"}>
            {getStatusIcon(item)}
          </span>
        </span>
      </button>

      {isOpen && hasDetails && (
        <div className="ml-3 space-y-2 rounded-[11px] border border-border-warm bg-white/75 px-3.5 py-2.5">
          {item.output && (
            isFileOp
              ? <DiffViewer output={item.output} />
              : (
                <div className="font-mono text-[11.5px] leading-[1.55] text-dark-warm whitespace-pre-wrap break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:whitespace-pre-wrap [&_code]:break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.output}</ReactMarkdown>
                </div>
              )
          )}
          {item.stderr && (
            <div className="font-mono text-[11.5px] leading-[1.55] text-coral whitespace-pre-wrap break-words">
              {item.stderr}
            </div>
          )}
          {item.cwdWarning && (
            <div className="font-mono text-[11.5px] leading-[1.55] text-amber-600 break-words">
              {item.cwdWarning}
            </div>
          )}
          {item.timeDisplay && (
            <div className="text-[11px] text-stone-gray">{item.timeDisplay}</div>
          )}
        </div>
      )}
    </div>
  );
};
