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
  Plus,
  Trash2,
} from "lucide-react";
import type { Session } from "@/api/types";

type Props = {
  activeId: string | null;
  onSelect: (session: Session) => void;
  sessions: Session[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createSession: () => Promise<Session>;
  killSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

export const Sidebar = ({
  activeId,
  onSelect,
  sessions,
  loading,
  error,
  refetch,
  createSession,
  killSession,
  renameSession,
  collapsed = false,
  onToggleCollapse,
}: Props) => {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [draft]);

  function handleStartRename(id: string, currentTitle: string) {
    setEditingId(id)
    setEditName(currentTitle)
  }

  async function handleRenameConfirm() {
    if (!editingId || !editName.trim()) return
    await renameSession(editingId, editName.trim())
    setEditingId(null)
    setEditName("")
  }

  async function handleKillSession(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm("Kill this session?")) return
    await killSession(id)
  }

  async function handleCreateSession() {
    const session = await createSession()
    onSelect(session)
    await refetch()
  }

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
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateSession}
            title="New session"
            className="text-[11px] text-stone-gray hover:text-near-black transition-colors p-1 rounded hover:bg-warm-sand"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button className="text-[11px] text-stone-gray hover:text-near-black transition-colors">
            Active ↓
          </button>
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-px scrollbar-warm-thin">
        {loading && (
          <div className="px-3 py-4 text-[11.5px] text-stone-gray italic">
            Loading sessions…
          </div>
        )}
        {error && (
          <div className="px-3 py-4 text-[11.5px] text-coral">
            {error}
            <button onClick={() => void refetch()} className="ml-2 underline">Retry</button>
          </div>
        )}
        {!loading && sessions.length === 0 && !error && (
          <div className="px-3 py-4 text-[11.5px] text-stone-gray italic">
            No sessions found.
          </div>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => onSelect(s)}
            onKill={(e) => void handleKillSession(e, s.id)}
            onStartRename={() => handleStartRename(s.id, s.title)}
            editingId={editingId}
            editName={editName}
            onEditChange={setEditName}
            onEditConfirm={handleRenameConfirm}
            onEditCancel={() => { setEditingId(null); setEditName("") }}
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
  onKill,
  onStartRename,
  editingId,
  editName,
  onEditChange,
  onEditConfirm,
  onEditCancel,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onKill: (e: React.MouseEvent) => void;
  onStartRename: () => void;
  editingId: string | null;
  editName: string;
  onEditChange: (v: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
}) => {
  const isEditing = editingId === session.id

  return (
    <div
      onClick={isEditing ? undefined : onSelect}
      className={`px-3 py-[7px] cursor-pointer border-l-2 flex items-start justify-between gap-[5px] transition-colors group ${
        active
          ? "bg-warm-sand border-terracotta"
          : "border-transparent hover:bg-black/[0.03]"
      }`}
    >
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            className="w-full text-[12.5px] font-medium text-near-black bg-white border border-border-warm rounded px-1 py-0.5"
            value={editName}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditConfirm()
              if (e.key === 'Escape') onEditCancel()
            }}
            onBlur={onEditConfirm}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="text-[12.5px] font-medium text-near-black truncate leading-[1.3] mb-px">
            {session.title}
          </div>
        )}
        <div className="text-[10.5px] text-stone-gray truncate">{session.description}</div>
      </div>
      <div className="flex items-center gap-[3px] flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
        <button
          onClick={(e) => { e.stopPropagation(); onStartRename() }}
          title="Rename"
          className="w-[18px] h-[18px] flex items-center justify-center rounded text-stone-gray hover:text-near-black hover:bg-warm-sand transition-colors"
        >
          ✏
        </button>
        <button
          onClick={onKill}
          title="Kill session"
          className="w-[18px] h-[18px] flex items-center justify-center rounded text-stone-gray hover:text-coral hover:bg-warm-sand transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};