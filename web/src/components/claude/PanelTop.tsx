import { PanelLeft, Coins, ListTodo, Download, BarChart2, Search, Clock, DollarSign, Database, BookOpen, Stethoscope, Bug, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import { getApiClient } from "../../api/client";
import { ensureApiAuthenticated } from "../../features/chat/streamTransport";
import { ModelPicker } from "./ModelPicker";
import { EffortPicker } from "./EffortPicker";
import { PermissionModePicker } from "./PermissionModePicker";
import { ExportDialog } from "./ExportDialog";

type Props = {
  title: string;
  sessionId?: string | null;
  status?: string | null;
  lastMessageAt?: string | null;
  connectionState?: 'connected' | 'reconnecting' | 'restarted' | 'interrupted' | 'failed';
  onOpenSidebar?: () => void;
  onToggleTasks?: () => void;
  tasksOpen?: boolean;
  onToggleContext?: () => void;
  contextOpen?: boolean;
  onOpenSearch?: () => void;
  onOpenHistory?: () => void;
  onOpenMcp?: () => void;
  onOpenMemory?: () => void;
  onOpenDiagnostics?: () => void;
  onOpenBugReport?: () => void;
  onToggleAgents?: () => void;
  agentsOpen?: boolean;
};

function getStatusCopy(
  status?: string | null,
  lastMessageAt?: string | null,
  connectionState?: 'connected' | 'reconnecting' | 'restarted' | 'interrupted' | 'failed',
): string | null {
  const normalized = status?.trim();
  const age = lastMessageAt
    ? formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true })
    : null;

  if (connectionState === 'reconnecting') return 'Reconnecting…';
  if (connectionState === 'restarted') return 'Server restarted';
  if (connectionState === 'interrupted') return 'Session interrupted';
  if (connectionState === 'failed') return 'Connection failed';

  if (!normalized && !age) return null;
  if (!normalized) return age;
  if (!age) return normalized;
  return `${normalized} · ${age}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function getStatusDotClass(status?: string | null, connectionState?: Props['connectionState']): string {
  if (connectionState === 'reconnecting') return 'bg-amber-400';
  if (connectionState === 'restarted' || connectionState === 'interrupted' || connectionState === 'failed') {
    return 'bg-red-500';
  }

  switch (status?.trim().toLowerCase()) {
    case "running":
      return "bg-emerald-500";
    case "idle":
      return "bg-amber-400";
    case "interrupted":
      return "bg-red-500";
    case "inactive":
    case "archived":
      return "bg-stone-400";
    default:
      return "bg-stone-400";
  }
}

export const PanelTop = ({
  title,
  sessionId,
  status,
  lastMessageAt,
  connectionState,
  onOpenSidebar,
  onToggleTasks,
  tasksOpen,
  onToggleContext,
  contextOpen,
  onOpenSearch,
  onOpenHistory,
  onOpenMcp,
  onOpenMemory,
  onOpenDiagnostics,
  onOpenBugReport,
  onToggleAgents,
  agentsOpen,
}: Props) => {
  const [tokens, setTokens] = useState<{ input: number; output: number } | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [effort, setEffort] = useState("medium");
  const [permissionMode, setPermissionMode] = useState("default");
  const [exportOpen, setExportOpen] = useState(false);
  const client = getApiClient();

  useEffect(() => {
    let cancelled = false;

    const loadState = async () => {
      try {
        await ensureApiAuthenticated(client);
        const state = await client.getState(sessionId ?? undefined);
        if (!cancelled) {
          setTokens({
            input: state.tokenUsage?.inputTokens ?? 0,
            output: state.tokenUsage?.outputTokens ?? 0,
          });
          if (state.model) setModel(state.model);
          if (state.thinkingEffort) setEffort(state.thinkingEffort);
          if (state.permissionMode) setPermissionMode(state.permissionMode);
        }
      } catch {
        // ignore
      }
    };

    const loadUsage = async () => {
      try {
        await ensureApiAuthenticated(client);
        const usage = await client.getUsage();
        if (!cancelled) {
          setCost(usage.cost.total);
        }
      } catch {
        // ignore
      }
    };

    void loadState();
    void loadUsage();
    const interval = setInterval(() => {
      void loadState();
      void loadUsage();
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [client, sessionId]);

  const updateModel = async (nextModel: string) => {
    setModel(nextModel);
    if (!sessionId) {
      return;
    }

    try {
      await ensureApiAuthenticated(client);
      await client.updateState({
        sessionId,
        model: nextModel,
      });
    } catch {
      // keep optimistic UI for now; polling will reconcile with backend state
    }
  };

  const updateEffort = async (nextEffort: string) => {
    setEffort(nextEffort);
    if (!sessionId) {
      return;
    }

    try {
      await ensureApiAuthenticated(client);
      await client.updateState({
        sessionId,
        thinkingEffort: nextEffort,
      });
    } catch {
      // keep optimistic UI for now; polling will reconcile with backend state
    }
  };

  const updatePermissionMode = async (nextMode: string) => {
    setPermissionMode(nextMode);
    if (!sessionId) {
      return;
    }

    try {
      await ensureApiAuthenticated(client);
      await client.updateState({
        sessionId,
        permissionMode: nextMode,
      });
    } catch {
      // keep optimistic UI for now; polling will reconcile with backend state
    }
  };

  const IconButton = ({
    onClick,
    label,
    title: btnTitle,
    active,
    children,
  }: {
    onClick: () => void;
    label: string;
    title?: string;
    active?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={btnTitle ?? label}
      className={`w-[28px] h-[28px] rounded-[7px] border flex items-center justify-center transition-colors ${
        active
          ? "border-terracotta bg-terracotta/10 text-terracotta"
          : "border-border-warm bg-warm-sand text-charcoal-warm hover:text-near-black"
      }`}
    >
      {children}
    </button>
  );

  return (
    <>
    <div className="flex items-center justify-between gap-2 px-[17px] py-[10px] border-b border-border-cream bg-ivory flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="md:hidden w-[28px] h-[28px] rounded-[7px] border border-border-warm bg-warm-sand text-charcoal-warm flex items-center justify-center"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <h1 className="font-serif-display text-[14px] text-near-black truncate min-w-0">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
        <ModelPicker model={model} onChange={(nextModel) => void updateModel(nextModel)} />
        <EffortPicker effort={effort} onChange={(nextEffort) => void updateEffort(nextEffort)} />
        <PermissionModePicker permissionMode={permissionMode} onChange={(nextMode) => void updatePermissionMode(nextMode)} />

        {/* Token count + cost */}
        {tokens && (tokens.input > 0 || tokens.output > 0) && (
          <div className="flex items-center gap-1 text-[10.5px] text-stone-gray" title={`Input: ${tokens.input} tokens · Output: ${tokens.output} tokens`}>
            <Coins className="w-3 h-3" />
            <span>{formatTokens(tokens.input)}↑</span>
            <span>{formatTokens(tokens.output)}↓</span>
          </div>
        )}
        {cost !== null && cost > 0 && (
          <div className="flex items-center gap-0.5 text-[10.5px] text-stone-gray" title="Running cost (Sonnet pricing)">
            <DollarSign className="w-3 h-3" />
            <span>{formatCost(cost)}</span>
          </div>
        )}

        {/* Search */}
        {onOpenSearch && (
          <IconButton onClick={onOpenSearch} label="Search workspace" title="Search (Ctrl+Shift+F)">
            <Search className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* History */}
        {onOpenHistory && (
          <IconButton onClick={onOpenHistory} label="Prompt history" title="History (Ctrl+Shift+H)">
            <Clock className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Context window */}
        {onToggleContext && (
          <IconButton
            onClick={onToggleContext}
            label="Context window breakdown"
            title="Context window"
            active={contextOpen}
          >
            <BarChart2 className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* MCP servers */}
        {onOpenMcp && (
          <IconButton onClick={onOpenMcp} label="MCP servers" title="MCP servers">
            <Database className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Memory files */}
        {onOpenMemory && (
          <IconButton onClick={onOpenMemory} label="Memory files" title="Memory (CLAUDE.md)">
            <BookOpen className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Diagnostics */}
        {onOpenDiagnostics && (
          <IconButton onClick={onOpenDiagnostics} label="Diagnostics" title="Diagnostics (/doctor)">
            <Stethoscope className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Bug report */}
        {onOpenBugReport && (
          <IconButton onClick={onOpenBugReport} label="Report bug" title="Report bug">
            <Bug className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Export */}
        <IconButton onClick={() => setExportOpen(true)} label="Export conversation" title="Export">
          <Download className="w-3.5 h-3.5" />
        </IconButton>

        {/* Agents */}
        {onToggleAgents && (
          <IconButton
            onClick={onToggleAgents}
            label="Toggle agents"
            title="Agents"
            active={agentsOpen}
          >
            <Bot className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Tasks */}
        {onToggleTasks && (
          <IconButton
            onClick={onToggleTasks}
            label="Toggle tasks"
            title="Tasks"
            active={tasksOpen}
          >
            <ListTodo className="w-3.5 h-3.5" />
          </IconButton>
        )}

        {/* Status */}
        {getStatusCopy(status, lastMessageAt, connectionState) && (
          <div className="text-[11px] text-stone-gray flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotClass(status, connectionState)}`} />
            {getStatusCopy(status, lastMessageAt, connectionState)}
          </div>
        )}
      </div>
    </div>
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </>
  );
};
