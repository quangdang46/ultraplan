import { useState } from "react";
import { Bug, X, Send, Copy } from "lucide-react";
import { getApiClient } from "../../api/client";

type Props = {
  sessionId?: string | null;
  onClose: () => void;
};

export function BugReportDialog({ sessionId, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const client = getApiClient();
      let transcriptText = "";
      if (includeTranscript && sessionId) {
        try {
          const messages = await client.getSessionMessages(sessionId);
          transcriptText = messages
            .map((m) => `[${m.role}] ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
            .join("\n");
        } catch {
          // ignore
        }
      }

      const report = [
        `## Bug Report`,
        `**Title**: ${title}`,
        `**Session**: ${sessionId ?? "none"}`,
        ``,
        `## Description`,
        description,
        ``,
        `## Steps to reproduce`,
        steps,
        transcriptText ? [`\n## Transcript\n\`\`\`\n${transcriptText}\n\`\`\``] : [],
      ]
        .flat()
        .join("\n");

      // Copy to clipboard as the submission mechanism
      await navigator.clipboard.writeText(report);
      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    const body = [
      `## Bug Report`,
      `**Title**: ${title}`,
      `**Session**: ${sessionId ?? "none"}`,
      ``,
      `## Description`,
      description,
      ``,
      `## Steps to reproduce`,
      steps,
    ].join("\n");
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-cream">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-near-black">
            <Bug className="w-4 h-4 text-stone-gray" />
            Report a bug
          </div>
          <button onClick={onClose} className="text-stone-gray hover:text-charcoal-warm">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-stone-gray uppercase tracking-wide">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              className="w-full mt-1 rounded-lg border border-border-warm bg-white px-3 py-2 text-[12.5px] text-olive-gray outline-none focus:border-terracotta/50"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-stone-gray uppercase tracking-wide">What happened</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what went wrong…"
              rows={3}
              className="w-full mt-1 rounded-lg border border-border-warm bg-white px-3 py-2 text-[12.5px] text-olive-gray outline-none focus:border-terracotta/50 resize-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-stone-gray uppercase tracking-wide">Steps to reproduce</label>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="1. First step…\n2. Second step…"
              rows={3}
              className="w-full mt-1 rounded-lg border border-border-warm bg-white px-3 py-2 text-[12.5px] text-olive-gray outline-none focus:border-terracotta/50 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-[12px] text-stone-gray cursor-pointer">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(e) => setIncludeTranscript(e.target.checked)}
              className="accent-terracotta"
            />
            Attach session transcript
          </label>
        </div>

        <div className="px-4 py-3 border-t border-border-cream flex gap-2">
          <button
            onClick={() => void handleCopy()}
            disabled={!title.trim() || submitting}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-warm text-[12px] text-stone-gray hover:text-charcoal-warm disabled:opacity-50 transition-colors"
          >
            <Copy className="w-3 h-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!title.trim() || submitting}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-terracotta text-white text-[12px] hover:bg-coral disabled:opacity-50 transition-colors"
          >
            <Send className="w-3 h-3" />
            {submitted ? "Copied to clipboard!" : submitting ? "Preparing…" : "Copy & Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
