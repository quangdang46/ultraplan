import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  GitBranch,
  Hash,
  Settings,
  MessageSquare,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { sessions, type Session } from "@/data/claudeCode";

type Props = {
  activeId: number;
  onSelect: (id: number) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

export const Sidebar = ({ activeId, onSelect, collapsed = false, onToggleCollapse }: Props) => {
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [draft]);

  if (collapsed) {
    return (
      <aside className="h-full w-full bg-parchment border-r border-border-warm flex flex-col overflow-hidden items-center">
        <div className="w-full px-2 pt-[13px] pb-[10px] border-b border-border-cream flex-shrink-0 flex flex-col items-center gap-2">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="w-8 h-8 rounded-[7px] text-stone-gray hover:bg-warm-sand hover:text-near-black transition-colors flex items-center justify-center"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <span className="w-[21px] h-[21px] rounded-[5px] bg-near-black text-ivory font-serif-display text-[11px] flex items-center justify-center flex-shrink-0">
            A
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="h-full w-full bg-parchment border-r border-border-warm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-[13px] pb-[10px] border-b border-border-cream flex-shrink-0">
        <div className="flex items-center gap-[7px] mb-[10px]">
          <span className="w-[21px] h-[21px] rounded-[5px] bg-near-black text-ivory font-serif-display text-[11px] flex items-center justify-center flex-shrink-0">
            A
          </span>
          <span className="font-serif-display text-[17px] text-near-black tracking-[-0.3px]">
            Claude Code
          </span>
          <span className="bg-warm-sand text-olive-gray text-[10.5px] px-[7px] py-[2px] rounded-[5px]">
            Research preview
          </span>
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="ml-auto w-7 h-7 rounded-[7px] text-stone-gray hover:bg-warm-sand hover:text-near-black transition-colors flex items-center justify-center"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Composer */}
        <div className="relative mb-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Claude to write code…"
            rows={2}
            className="w-full bg-white border border-border-warm rounded-[11px] px-[11px] py-2 pr-10 text-[12.5px] text-olive-gray font-sans resize-none min-h-[58px] max-h-[120px] leading-[1.5] outline-none focus:shadow-[0_0_0_1.5px_hsl(var(--terracotta))] transition-shadow placeholder:text-stone-gray"
          />
          <button
            disabled={!draft.trim()}
            className="absolute right-[7px] bottom-[7px] w-[26px] h-[26px] bg-terracotta hover:bg-coral disabled:opacity-35 disabled:cursor-default rounded-[7px] text-white flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Chips */}
        <div className="flex gap-[5px]">
          <Chip icon={<GitBranch className="w-2.5 h-2.5" />}>buttondown/monorepo</Chip>
          <Chip icon={<Hash className="w-2.5 h-2.5" />}>Default</Chip>
        </div>
      </div>

      {/* Sessions header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 flex-shrink-0">
        <span className="text-xs font-semibold text-near-black">Sessions</span>
        <button className="text-[11px] text-stone-gray hover:text-near-black transition-colors">
          Active ↓
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-px scrollbar-warm-thin">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => onSelect(s.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border-warm px-3 py-2 flex gap-0.5 bg-parchment flex-shrink-0">
        <FootBtn label="Settings"><Settings className="w-3.5 h-3.5" /></FootBtn>
        <FootBtn label="Chat"><MessageSquare className="w-3.5 h-3.5" /></FootBtn>
        <FootBtn label="Notifications"><Bell className="w-3.5 h-3.5" /></FootBtn>
      </div>
    </aside>
  );
};

const Chip = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-center gap-1 bg-warm-sand text-charcoal-warm text-[11px] px-[9px] py-[3px] rounded-[7px] shadow-ring hover:shadow-ring-strong cursor-pointer whitespace-nowrap transition-shadow">
    <span className="text-olive-gray flex-shrink-0">{icon}</span>
    {children}
  </div>
);

const FootBtn = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <button
    title={label}
    className="w-[31px] h-[31px] flex items-center justify-center rounded-[7px] text-stone-gray hover:bg-warm-sand hover:text-near-black transition-colors"
  >
    {children}
  </button>
);

const SessionRow = ({
  session,
  active,
  onSelect,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
}) => (
  <div
    onClick={onSelect}
    className={`px-3 py-[7px] cursor-pointer border-l-2 flex items-start justify-between gap-[5px] transition-colors ${
      active
        ? "bg-warm-sand border-terracotta"
        : "border-transparent hover:bg-black/[0.03]"
    }`}
  >
    <div className="flex-1 min-w-0">
      <div className="text-[12.5px] font-medium text-near-black truncate leading-[1.3] mb-px">
        {session.title}
      </div>
      <div className="text-[10.5px] text-stone-gray">{session.sub}</div>
    </div>
    <div className="flex items-center gap-[3px] flex-shrink-0 mt-0.5">
      {session.diff && (
        <span className="bg-[hsl(var(--diff-green-bg))] text-[hsl(var(--diff-green-fg))] text-[10px] px-[5px] py-px rounded font-semibold">
          {session.diff}
        </span>
      )}
      {session.pr && (
        <span className="bg-[#fff7ed] text-terracotta border border-[#f5d4c2] text-[10px] px-[5px] py-px rounded">
          {session.pr}
        </span>
      )}
      {session.asterisk && <span className="text-coral text-[13px] leading-none">✳</span>}
    </div>
  </div>
);
