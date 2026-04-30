import { useState } from "react";
import { Download, Copy, Check } from "lucide-react";
import { useStreamContext } from "../../hooks/useStreamContext";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { messages } = useStreamContext();
  const [copied, setCopied] = useState(false);

  const text = messages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Claude";
      const tools = msg.toolCalls
        .map((t) => `  [${t.kind ?? "Tool"}: ${t.title}]${t.output ? `\n  ${t.output.slice(0, 200)}` : ""}`)
        .join("\n");
      return `${role}:\n${msg.content}${tools ? "\n" + tools : ""}`;
    })
    .join("\n\n---\n\n");

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border-cream bg-ivory p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif-display text-[15px] font-semibold text-near-black mb-1">Export conversation</h2>
        <p className="text-xs text-stone-gray mb-4">{messages.length} messages</p>

        <pre className="max-h-48 overflow-auto rounded-xl border border-border-warm bg-white/80 px-3 py-2 font-mono text-[11px] leading-5 text-charcoal-warm whitespace-pre-wrap break-words mb-4">
          {text.slice(0, 800)}{text.length > 800 ? "\n…" : ""}
        </pre>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-xs font-medium text-white hover:bg-[#c86a4b] transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-warm bg-white px-3 py-2 text-xs font-medium text-charcoal-warm hover:bg-warm-sand transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download .txt
          </button>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-border-warm bg-white px-3 py-2 text-xs font-medium text-stone-gray hover:bg-warm-sand transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
