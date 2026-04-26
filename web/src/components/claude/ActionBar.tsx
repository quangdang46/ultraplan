import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from "react";
import { ArrowUp, GitBranch, GitPullRequest, Terminal, ArrowRight, X, Pause } from "lucide-react";
import { useStreamContext } from "../../hooks/useStreamContext";

type Props = {
  quote: string | null;
  onClearQuote: () => void;
};

export const ActionBar = ({ quote, onClearQuote }: Props) => {
  const [reply, setReply] = useState("");
  const { sendMessage, cancelStream, isStreaming } = useStreamContext();

  const handleSubmit = () => {
    if (reply.trim() && sendMessage && !isStreaming) {
      sendMessage(reply.trim());
      setReply("");
    }
  };

  const handlePause = () => {
    cancelStream();
  };

  return (
    <div className="border-t border-border-warm bg-parchment px-3.5 pt-[7px] pb-[9px] flex-shrink-0">
      {/* Top row */}
      <div className="flex items-center gap-1.5 mb-[7px]">
        <div className="flex items-center gap-1 bg-warm-sand text-charcoal-warm text-[10.5px] font-mono-claude px-[9px] py-1 rounded-[7px] border border-border-warm flex-1 min-w-0 overflow-hidden">
          <GitBranch className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">claude/research-cloudflare-cac...</span>
        </div>

        <DkBtn>
          <GitPullRequest className="w-2.5 h-2.5" />
          Create PR
          <span className="text-warm-silver text-xs border-l border-[#4a4846] pl-1.5 ml-px">⋮</span>
        </DkBtn>

        <DkBtn>
          <Terminal className="w-2.5 h-2.5" />
          Open in CLI
          <ArrowRight className="w-2 h-2" strokeWidth={2.5} />
        </DkBtn>
      </div>

      {/* Reply quote */}
      {quote && (
        <div className="bg-[#fff8f5] border border-[#f5d4c4] border-b-0 rounded-t-[9px] px-[11px] py-[7px]">
          <div className="text-[10.5px] text-terracotta font-semibold mb-0.5 flex items-center justify-between tracking-wide">
            <span>↩ Replying to selection</span>
            <button
              onClick={onClearQuote}
              className="text-stone-gray hover:text-near-black p-0 px-0.5 leading-none transition-colors"
              aria-label="Clear quote"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="text-xs text-charcoal-warm leading-[1.5] italic line-clamp-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{quote}</ReactMarkdown>
          </div>
        </div>
      )}

      <div className="relative">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
          placeholder={isStreaming ? "Thinking..." : "Reply…"}
          disabled={isStreaming}
          className={`w-full bg-white border border-border-warm px-3 py-2 pr-11 text-[12.5px] text-olive-gray font-sans outline-none focus:border-terracotta/50 focus:shadow-[0_0_0_1.5px_hsl(var(--terracotta)/0.15)] transition-all placeholder:text-stone-gray disabled:bg-warm-sand/30 disabled:cursor-not-allowed ${
            quote ? "rounded-t-none rounded-b-[10px] border-t-transparent" : "rounded-[10px]"
          }`}
        />
        <button
          onClick={isStreaming ? handlePause : handleSubmit}
          className={`absolute right-[7px] top-1/2 -translate-y-1/2 w-[25px] h-[25px] rounded-md text-white flex items-center justify-center transition-colors ${
            isStreaming
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-terracotta hover:bg-coral"
          }`}
          aria-label={isStreaming ? "Pause" : "Send reply"}
        >
          {isStreaming ? (
            <Pause className="w-3 h-3" />
          ) : (
            <ArrowUp className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
};

const DkBtn = ({ children }: { children: React.ReactNode }) => (
  <button className="bg-dark-surface hover:bg-[#3a3836] text-ivory rounded-[7px] px-[11px] py-[5px] text-[11.5px] font-sans flex items-center gap-1.5 whitespace-nowrap shadow-[0_0_0_1px_#3a3836] transition-colors">
    {children}
  </button>
);
