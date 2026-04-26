import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, GitBranch, GitPullRequest, Terminal, ArrowRight, X, Pause, Folder, FileText, Command } from "lucide-react";
import { useStreamContext } from "../../hooks/useStreamContext";
import { getApiClient } from "../../api/client";
import type { CommandSuggestion, FileSuggestion } from "../../api/types";

type Props = {
  quote: string | null;
  onClearQuote: () => void;
};

type TriggerState = {
  trigger: '@' | '/';
  query: string;
  start: number;
  end: number;
  quoted?: boolean;
};

type SuggestionViewItem = {
  key: string;
  label: string;
  detail?: string;
  tag?: string;
  type?: string;
  insertionText: string;
  argumentHint?: string;
};

const AT_TOKEN_HEAD_RE = /^@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
const PATH_CHAR_HEAD_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const normalized = query.trim();
  if (!normalized) {
    return <>{text}</>;
  }
  const regex = new RegExp(`(${escapeRegExp(normalized)})`, "ig");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, idx) => {
        const isMatch = part.toLowerCase() === normalized.toLowerCase();
        return isMatch ? (
          <mark key={`${part}-${idx}`} className="bg-terracotta/20 text-near-black rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${idx}`}>{part}</span>
        );
      })}
    </>
  );
}

function extractTaggedFiles(input: string): string[] {
  const regex = /(^|\s)@(?:"([^"]+)"|([^\s]+))/g;
  const out: string[] = [];
  let match = regex.exec(input);
  while (match) {
    const value = match[2] || match[3];
    if (value) out.push(value);
    match = regex.exec(input);
  }
  return out;
}

function extractCompletionToken(
  text: string,
  cursorPos: number,
): { token: string; startPos: number; isQuoted?: boolean } | null {
  if (!text) return null;
  const textBeforeCursor = text.substring(0, cursorPos);

  const quotedAtRegex = /@"([^"]*)"?$/;
  const quotedMatch = textBeforeCursor.match(quotedAtRegex);
  if (quotedMatch && quotedMatch.index !== undefined) {
    const textAfterCursor = text.substring(cursorPos);
    const afterQuotedMatch = textAfterCursor.match(/^[^"]*"?/);
    const quotedSuffix = afterQuotedMatch ? afterQuotedMatch[0] : "";
    return {
      token: quotedMatch[0] + quotedSuffix,
      startPos: quotedMatch.index,
      isQuoted: true,
    };
  }

  const atIdx = textBeforeCursor.lastIndexOf("@");
  if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1] ?? ""))) {
    const fromAt = textBeforeCursor.substring(atIdx);
    const atHeadMatch = fromAt.match(AT_TOKEN_HEAD_RE);
    if (atHeadMatch && atHeadMatch[0].length === fromAt.length) {
      const textAfterCursor = text.substring(cursorPos);
      const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
      const tokenSuffix = afterMatch ? afterMatch[0] : "";
      return {
        token: atHeadMatch[0] + tokenSuffix,
        startPos: atIdx,
        isQuoted: false,
      };
    }
  }

  const slashRegex = /(^|\s)\/([^\s/]*)$/;
  const slashMatch = textBeforeCursor.match(slashRegex);
  if (slashMatch && slashMatch.index !== undefined) {
    const tokenStart = slashMatch.index + (slashMatch[1]?.length ?? 0);
    const token = textBeforeCursor.slice(tokenStart);
    return { token, startPos: tokenStart, isQuoted: false };
  }

  return null;
}

function parseTriggerState(value: string, cursor: number): TriggerState | null {
  const completion = extractCompletionToken(value, cursor);
  if (!completion) return null;
  const token = completion.token;
  const start = completion.startPos;
  const end = start + token.length;
  if (!token) return null;
  if (token.startsWith('/')) {
    return { trigger: '/', query: token.slice(1), start, end };
  }
  if (!token.startsWith('@')) return null;
  let body = token.slice(1);
  let quoted = false;
  if (body.startsWith('"')) {
    quoted = true;
    body = body.slice(1);
  }
  if (body.endsWith('"')) {
    body = body.slice(0, -1);
  }
  return { trigger: '@', query: body, start, end, quoted };
}

function formatAtInsertion(text: string, keepQuoted?: boolean): string {
  const needsQuotes = keepQuoted || /\s/.test(text);
  return needsQuotes ? `@"${text}"` : `@${text}`;
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  let prefix = values[0] ?? "";
  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] ?? "";
    let j = 0;
    while (j < prefix.length && j < current.length && prefix[j] === current[j]) j += 1;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

export const ActionBar = ({ quote, onClearQuote }: Props) => {
  const [reply, setReply] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestionViewItem[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionsMeta, setSuggestionsMeta] = useState<{ isPartial?: boolean; capApplied?: boolean }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);
  const client = getApiClient();
  const { sendMessage, executeSlashCommand, cancelStream, isStreaming } = useStreamContext();

  const triggerState = useMemo(() => parseTriggerState(reply, cursorPos), [reply, cursorPos]);
  const taggedFiles = useMemo(() => extractTaggedFiles(reply), [reply]);

  useEffect(() => {
    if (!triggerState) {
      setSuggestions([]);
      setSelectedIndex(0);
      setIsSuggesting(false);
      setSuggestionError(null);
      setSuggestionsMeta({});
      return;
    }

    setSuggestions([]);
    setSelectedIndex(0);

    let isCancelled = false;
    const seq = ++requestSeqRef.current;
    const timer = setTimeout(async () => {
      setIsSuggesting(true);
      setSuggestionError(null);
      try {
        if (triggerState.trigger === "@") {
          const result = await client.suggestFiles(triggerState.query);
          if (isCancelled || seq !== requestSeqRef.current) return;
          const mapped = result.items.map((item: FileSuggestion) => ({
            key: item.id ?? item.path ?? item.displayText,
            label: item.displayText ?? item.path ?? "",
            detail: item.description,
            tag: item.tag,
            type: item.type,
            insertionText: item.insertText ?? item.displayText ?? item.path ?? "",
          }));
          setSuggestions(mapped);
          setSuggestionsMeta({ isPartial: result.isPartial, capApplied: result.capApplied });
        } else {
          const result = await client.suggestCommands(triggerState.query);
          if (isCancelled || seq !== requestSeqRef.current) return;
          const mapped = result.items.map((item: CommandSuggestion) => ({
            key: item.name,
            label: `/${item.name}`,
            detail: item.description,
            type: "command",
            insertionText: item.name,
            argumentHint: item.argumentHint,
          }));
          setSuggestions(mapped);
          setSuggestionsMeta({});
        }
        setSelectedIndex(0);
      } catch {
        if (isCancelled || seq !== requestSeqRef.current) return;
        setSuggestions([]);
        setSuggestionError("Failed to load suggestions");
        setSuggestionsMeta({});
      } finally {
        if (!isCancelled && seq === requestSeqRef.current) {
          setIsSuggesting(false);
        }
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [client, triggerState]);

  const applySuggestion = (index: number) => {
    if (!triggerState) return;
    const item = suggestions[index];
    if (!item) return;
    const baseInsertion =
      triggerState.trigger === "@"
        ? formatAtInsertion(item.insertionText, triggerState.quoted)
        : `/${item.insertionText}`;
    const insertion = `${baseInsertion} `;
    const nextValue =
      reply.slice(0, triggerState.start) +
      insertion +
      reply.slice(triggerState.end);
    const nextCursor = triggerState.start + insertion.length;
    setReply(nextValue);
    setCursorPos(nextCursor);
    setSuggestions([]);
    setSelectedIndex(0);
    setSuggestionError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const applyCommonPrefix = (): boolean => {
    if (!triggerState || triggerState.trigger !== "@") return false;
    if (suggestions.length === 0) return false;
    const values = suggestions.map((item) => item.insertionText);
    const prefix = longestCommonPrefix(values);
    if (!prefix || prefix.length <= triggerState.query.length) return false;
    const replacement = formatAtInsertion(prefix, triggerState.quoted);
    const nextValue = reply.slice(0, triggerState.start) + replacement + reply.slice(triggerState.end);
    const nextCursor = triggerState.start + replacement.length;
    setReply(nextValue);
    setCursorPos(nextCursor);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
    return true;
  };

  const handleSubmit = () => {
    const text = reply.trim();
    if (!text || isStreaming) return;

    if (text.startsWith("/")) {
      executeSlashCommand(text);
      setReply("");
      setCursorPos(0);
      setSuggestions([]);
      setSuggestionError(null);
      return;
    }

    sendMessage(text);
    setReply("");
    setCursorPos(0);
    setSuggestions([]);
    setSuggestionError(null);
  };

  const handlePause = () => {
    cancelStream();
  };

  return (
    <div className="border-t border-border-warm bg-parchment px-3.5 pt-[7px] pb-[9px] flex-shrink-0 overflow-visible">
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
        {taggedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {taggedFiles.map((file) => (
              <span
                key={file}
                className="inline-flex items-center rounded-[7px] border border-[#f0d5c8] bg-[#fff5ef] px-2 py-1 text-[11px] text-terracotta"
              >
                @{file}
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            setCursorPos(e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) => setCursorPos((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyUp={(e) => setCursorPos((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              const isNext = e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "N"));
              const isPrev = e.key === "ArrowUp" || (e.ctrlKey && (e.key === "p" || e.key === "P"));
              if (e.key === "Tab") {
                e.preventDefault();
                const expanded = applyCommonPrefix();
                if (!expanded) {
                  applySuggestion(selectedIndex);
                }
                return;
              }
              if (isNext) {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % suggestions.length);
                return;
              }
              if (isPrev) {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter") {
                // Slash entries with argument text should submit instead of force-selecting.
                if (triggerState?.trigger === "/" && triggerState.query.includes(" ")) {
                  return;
                }
                e.preventDefault();
                applySuggestion(selectedIndex);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSuggestions([]);
                setSuggestionError(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isStreaming ? "Thinking..." : "Reply…"}
          disabled={isStreaming}
          className={`w-full bg-white border border-border-warm px-3 py-2 pr-11 text-[12.5px] text-olive-gray font-sans outline-none focus:border-terracotta/50 focus:shadow-[0_0_0_1.5px_hsl(var(--terracotta)/0.15)] transition-all placeholder:text-stone-gray disabled:bg-warm-sand/30 disabled:cursor-not-allowed ${
            quote ? "rounded-t-none rounded-b-[10px] border-t-transparent" : "rounded-[10px]"
          }`}
        />
        {triggerState && (
          <div className="absolute left-2 -top-6 text-[10.5px] text-stone-gray">
            {triggerState.trigger === "@" ? "Mention file" : "Slash command"}
          </div>
        )}
        {(triggerState && (isSuggesting || suggestions.length > 0 || suggestionError !== null)) && (
          <div className="absolute left-0 right-0 bottom-[calc(100%+6px)] z-50 rounded-[10px] border border-border-warm bg-white shadow-[0_8px_20px_rgba(0,0,0,0.08)] overflow-hidden">
            {isSuggesting ? (
              <div className="px-3 py-2 text-[12px] text-stone-gray">Loading suggestions…</div>
            ) : suggestionError ? (
              <div className="px-3 py-2 text-[12px] text-red-600">{suggestionError}</div>
            ) : suggestions.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-stone-gray">No results</div>
            ) : (
              <div className="max-h-64 overflow-y-auto scrollbar-warm-thin">
                {(suggestionsMeta.isPartial || suggestionsMeta.capApplied) && (
                  <div className="px-3 py-2 text-[11px] text-stone-gray border-b border-border-cream bg-[#faf9f7]">
                    {suggestionsMeta.isPartial ? "Index refreshing... showing partial results." : ""}
                    {suggestionsMeta.isPartial && suggestionsMeta.capApplied ? " " : ""}
                    {suggestionsMeta.capApplied ? "Showing top ranked results." : ""}
                  </div>
                )}
                {suggestions.map((item, index) => (
                  <button
                    key={item.key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(index);
                    }}
                    className={`w-full text-left px-3 py-2.5 border-b border-border-cream last:border-b-0 ${
                      index === selectedIndex ? "bg-warm-sand" : "bg-white hover:bg-warm-sand/70"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-stone-gray shrink-0">
                        {item.type === "directory" ? (
                          <Folder className="w-3.5 h-3.5" />
                        ) : item.type === "command" ? (
                          <Command className="w-3.5 h-3.5" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <div className="text-[12px] text-near-black truncate">
                        <HighlightMatch text={item.label} query={triggerState?.query ?? ""} />
                      </div>
                      {item.tag && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-warm-sand text-charcoal-warm shrink-0">
                          {item.tag}
                        </span>
                      )}
                    </div>
                    {item.detail && (
                      <div className="text-[11px] text-stone-gray mt-0.5 truncate">
                        {item.detail}
                        {item.argumentHint ? ` ${item.argumentHint}` : ""}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
