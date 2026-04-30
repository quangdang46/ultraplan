import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/claude/Sidebar";
import { PanelTop } from "@/components/claude/PanelTop";
import { Conversation } from "@/components/claude/Conversation";
import { MermaidPanel } from "@/components/claude/MermaidPanel";
import { ActionBar } from "@/components/claude/ActionBar";
import { TaskList } from "@/components/claude/TaskList";
import { ContextBar } from "@/components/claude/ContextBar";
import { UsageWarnings } from "@/components/claude/UsageWarnings";
import { HistoryDialog } from "@/components/claude/HistoryDialog";
import { SearchDialog } from "@/components/claude/SearchDialog";
import { McpManagerDialog } from "@/components/claude/McpManagerDialog";
import { MemoryDialog } from "@/components/claude/MemoryDialog";
import { DiagnosticsDialog } from "@/components/claude/DiagnosticsDialog";
import { BugReportDialog } from "@/components/claude/BugReportDialog";
import { AgentPanel } from "@/components/claude/AgentPanel";
import { StreamProvider, useStreamContext } from "@/hooks/useStreamContext";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
	SelectionTooltip,
	type SelectionAction,
} from "@/components/claude/SelectionTooltip";
import type { Session } from "@/api/types";
import { ApiClientError, getApiClient } from "@/api/client";
import { hydrateSessionMessages } from "@/features/chat/hydrateSessionMessages";
import {
	shouldAdoptPendingSessionRoute,
	shouldHydrateRouteSession,
	shouldPreserveLiveSession,
} from "@/features/chat/sessionRuntime";
import { ensureApiAuthenticated } from "@/features/chat/streamTransport";
import { useSessions } from "@/hooks/useSessions";
import { useLocation, useNavigate, useParams } from "react-router-dom";

function SessionHeader({
	title,
	status,
	lastMessageAt,
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
}: React.ComponentProps<typeof PanelTop>) {
	const { connectionState } = useStreamContext();

	return (
		<PanelTop
			title={title}
			status={status}
			lastMessageAt={lastMessageAt}
			connectionState={connectionState}
			onOpenSidebar={onOpenSidebar}
			onToggleTasks={onToggleTasks}
			tasksOpen={tasksOpen}
			onToggleContext={onToggleContext}
			contextOpen={contextOpen}
			onOpenSearch={onOpenSearch}
			onOpenHistory={onOpenHistory}
			onOpenMcp={onOpenMcp}
			onOpenMemory={onOpenMemory}
			onOpenDiagnostics={onOpenDiagnostics}
			onOpenBugReport={onOpenBugReport}
			onToggleAgents={onToggleAgents}
			agentsOpen={agentsOpen}
		/>
	);
}

const Index = () => {
	const [diagramsOpen, setDiagramsOpen] = useState(false);
	const [renderToken, setRenderToken] = useState(0);
	const [quote, setQuote] = useState<string | null>(null);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
	const [activeSession, setActiveSession] = useState<Session | null>(null);
	const [tasksOpen, setTasksOpen] = useState(false);
	const [contextBarOpen, setContextBarOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [mcpOpen, setMcpOpen] = useState(false);
	const [memoryOpen, setMemoryOpen] = useState(false);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
	const [bugReportOpen, setBugReportOpen] = useState(false);
	const [agentsOpen, setAgentsOpen] = useState(false);
	const [showResumeBanner, setShowResumeBanner] = useState(false);
	const [resumeLoading, setResumeLoading] = useState(false);
	const desktopContentRef = useRef<HTMLDivElement>(null);
	const mobileContentRef = useRef<HTMLDivElement>(null);
	const [isMobile, setIsMobile] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	const { chatId } = useParams<{ chatId?: string }>();
	const { sessions, loading, error, refetch, createSession, killSession, renameSession } = useSessions();
	const resolvedSessionId = chatId ?? activeSession?.id ?? null;

	useEffect(() => {
		if (location.pathname === "/") {
			navigate("/new", { replace: true });
		}
	}, [location.pathname, navigate]);

	// Global keyboard shortcuts
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
				e.preventDefault();
				setSearchOpen((v) => !v);
			}
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "H") {
				e.preventDefault();
				setHistoryOpen((v) => !v);
			}
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
				e.preventDefault();
				setBugReportOpen((v) => !v);
			}
		}
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, []);

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 767px)");
		const sync = () => setIsMobile(mq.matches);
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

	useEffect(() => {
		setQuote(null);
	}, [activeSession?.id]);

	useEffect(() => {
		if (!chatId) {
			setActiveSession(null);
			return;
		}
		const found = sessions.find((s) => s.id === chatId) ?? null;
		setActiveSession(found);
	}, [chatId, sessions]);

	// Show resume banner when session is interrupted
	useEffect(() => {
		if (activeSession?.status === 'interrupted') {
			setShowResumeBanner(true);
		} else {
			setShowResumeBanner(false);
		}
	}, [activeSession?.status]);

	// Dismiss resume banner when user navigates away
	useEffect(() => {
		if (!chatId) {
			setShowResumeBanner(false);
		}
	}, [chatId]);

	function handleSelectionAction(action: SelectionAction, text: string) {
		if (action === "reply") {
			setQuote(text);
		} else if (action === "copy") {
			navigator.clipboard.writeText(text).catch(() => {});
		} else if (action === "explain") {
			const short = text.length > 60 ? text.slice(0, 60) + "…" : text;
			setQuote(`Explain: "${short}"`);
		}
	}

	function handleSessionSelect(session: Session) {
		setActiveSession(session);
		navigate(`/chat/${session.id}`);
	}

	async function handleResumeSession() {
		if (!activeSession?.id) return;
		setResumeLoading(true);
		try {
			const client = getApiClient();
			await client.resumeSession(activeSession.id);
			await refetch();
			const updated = sessions.find((s) => s.id === activeSession.id);
			if (updated) setActiveSession(updated);
			setShowResumeBanner(false);
		} catch (err) {
			console.error('Failed to resume session', err);
		} finally {
			setResumeLoading(false);
		}
	}

	// Shared PanelTop props factory
	const panelTopProps = (openSidebar?: () => void) => ({
		title: activeSession?.title ?? (chatId ? "Loading session" : "New session"),
		status: activeSession?.status ?? null,
		lastMessageAt: activeSession?.lastMessageAt ?? null,
		onOpenSidebar: openSidebar,
		onToggleTasks: () => setTasksOpen((v) => !v),
		tasksOpen,
		onToggleContext: () => setContextBarOpen((v) => !v),
		contextOpen: contextBarOpen,
		onOpenSearch: () => setSearchOpen(true),
		onOpenHistory: () => setHistoryOpen(true),
		onOpenMcp: () => setMcpOpen(true),
		onOpenMemory: () => setMemoryOpen(true),
		onOpenDiagnostics: () => setDiagnosticsOpen(true),
		onOpenBugReport: () => setBugReportOpen(true),
		onToggleAgents: () => setAgentsOpen((v) => !v),
		agentsOpen,
	});

	const desktopHeaderProps = panelTopProps();
	const mobileHeaderProps = panelTopProps(() => setMobileSidebarOpen(true));

	// Shared inner content (Conversation + ActionBar + tasks panel)
	const renderInnerContent = (
		contentRef: React.RefObject<HTMLDivElement>,
		enabled: boolean,
		headerProps: React.ComponentProps<typeof PanelTop>,
		contentClassName = "flex-1 min-h-0 overflow-y-auto px-6 py-5 scrollbar-warm",
	) => (
		<StreamProvider>
			<SessionRouteSync chatId={chatId ?? null} onSessionReady={refetch} />
			<SessionRuntimeLoader sessionId={resolvedSessionId} enabled={enabled} />
			<div className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden">
				<SessionHeader {...headerProps} />
				<UsageWarnings sessionId={resolvedSessionId} />
				{contextBarOpen && (
					<ContextBar
						sessionId={resolvedSessionId}
						onClose={() => setContextBarOpen(false)}
					/>
				)}

				<div className="flex flex-1 min-h-0">
					<div
						ref={contentRef}
						className={contentClassName}
					>
						<Conversation />
					</div>
					{tasksOpen && (
						<div className="w-64 flex-shrink-0 border-l border-border-cream bg-parchment overflow-y-auto p-3">
							<div className="text-xs font-semibold text-near-black mb-2">Tasks</div>
							<TaskList />
						</div>
					)}
					{agentsOpen && (
						<div className="w-64 flex-shrink-0 border-l border-border-cream bg-parchment overflow-y-auto">
							<div className="px-3 pt-3 pb-1 text-xs font-semibold text-near-black">Agents</div>
							<AgentPanel />
						</div>
					)}
				</div>

				<ActionBar
					quote={quote}
					onClearQuote={() => setQuote(null)}
					sessionId={resolvedSessionId}
				/>
			</div>
		</StreamProvider>
	);

	return (
		<main className="w-full overflow-hidden shadow-window h-screen">
			{/* Desktop */}
			{!isMobile && (
			<div className="h-full">
				{desktopSidebarCollapsed ? (
					<div className="h-full bg-parchment flex">
						<div className="w-[64px] flex-shrink-0">
							<Sidebar
								activeId={activeSession?.id ?? null}
								onSelect={handleSessionSelect}
								sessions={sessions}
								loading={loading}
								error={error}
								refetch={refetch}
								createSession={createSession}
								killSession={killSession}
								renameSession={renameSession}
								collapsed
								onToggleCollapse={() => setDesktopSidebarCollapsed(false)}
							/>
						</div>
						<div className="flex-1 min-w-0">
							<section className="flex h-full flex-col bg-ivory min-h-0">
								{renderInnerContent(desktopContentRef, !isMobile, desktopHeaderProps)}
							</section>
						</div>
					</div>
				) : (
					<ResizablePanelGroup direction="horizontal" className="h-full bg-parchment">
						<ResizablePanel defaultSize={24} minSize={16} maxSize={36}>
							<Sidebar
								activeId={activeSession?.id ?? null}
								onSelect={handleSessionSelect}
								sessions={sessions}
								loading={loading}
								error={error}
								refetch={refetch}
								createSession={createSession}
								killSession={killSession}
								renameSession={renameSession}
								collapsed={false}
								onToggleCollapse={() => setDesktopSidebarCollapsed(true)}
							/>
						</ResizablePanel>
						<ResizableHandle withHandle className="bg-border-warm/70" />

						<ResizablePanel defaultSize={76} minSize={64}>
							<section className="flex h-full flex-col bg-ivory min-h-0">
								{showResumeBanner && (
									<div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
										<div className="flex items-center gap-2">
											<span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
											<span className="text-sm text-amber-800">Session interrupted. Resume to continue.</span>
										</div>
										<button
											onClick={handleResumeSession}
											disabled={resumeLoading}
											className="rounded-[8px] bg-terracotta px-3 py-1.5 text-sm text-white hover:bg-terracotta/90 transition-colors disabled:opacity-50"
										>
											{resumeLoading ? 'Resuming…' : 'Resume Session'}
										</button>
									</div>
								)}
								{renderInnerContent(desktopContentRef, !isMobile, desktopHeaderProps)}
							</section>
						</ResizablePanel>
					</ResizablePanelGroup>
				)}
			</div>
			)}

			{/* Mobile */}
			{isMobile && (
			<div className="h-full bg-ivory">
				{showResumeBanner && (
					<div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
						<div className="flex items-center gap-2">
							<span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
							<span className="text-sm text-amber-800">Session interrupted. Resume to continue.</span>
						</div>
						<button
							onClick={handleResumeSession}
							disabled={resumeLoading}
							className="rounded-[8px] bg-terracotta px-3 py-1.5 text-sm text-white hover:bg-terracotta/90 transition-colors disabled:opacity-50"
						>
							{resumeLoading ? 'Resuming…' : 'Resume Session'}
						</button>
					</div>
				)}
				{renderInnerContent(
					mobileContentRef,
					isMobile,
					mobileHeaderProps,
					"flex-1 min-h-0 overflow-y-auto px-4 py-4 scrollbar-warm",
				)}

				{/* Mobile sidebar drawer */}
				<div
					className={`fixed inset-0 z-40 transition-opacity ${
						mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
					}`}
				>
					<button
						aria-label="Close sidebar"
						className="absolute inset-0 bg-black/40"
						onClick={() => setMobileSidebarOpen(false)}
					/>
					<div
						className={`absolute left-0 top-0 h-full w-[88%] max-w-[340px] transition-transform duration-200 ${
							mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
						}`}
					>
						<Sidebar
							activeId={activeSession?.id ?? null}
							onSelect={(session) => {
								handleSessionSelect(session);
								setMobileSidebarOpen(false);
							}}
							sessions={sessions}
							loading={loading}
							error={error}
							refetch={refetch}
							createSession={createSession}
							killSession={killSession}
							renameSession={renameSession}
						/>
					</div>
				</div>

				{/* Mobile diagrams as full-screen overlay */}
				{diagramsOpen && (
					<div className="fixed inset-0 z-50 bg-parchment">
						<MermaidPanel
							onClose={() => setDiagramsOpen(false)}
							renderToken={renderToken}
						/>
					</div>
				)}
			</div>
			)}

			<SelectionTooltip
				containerRef={isMobile ? mobileContentRef : desktopContentRef}
				onAction={handleSelectionAction}
			/>

			{/* Global dialogs */}
			{historyOpen && (
				<HistoryDialog
					onClose={() => setHistoryOpen(false)}
					onSelect={(text) => setQuote(text)}
				/>
			)}
			{searchOpen && (
				<SearchDialog
					onClose={() => setSearchOpen(false)}
					onSelect={(ref) => {
						setQuote((q) => q ? `${q} ${ref}` : ref);
					}}
				/>
			)}
			{mcpOpen && <McpManagerDialog onClose={() => setMcpOpen(false)} />}
			{memoryOpen && <MemoryDialog onClose={() => setMemoryOpen(false)} />}
			{diagnosticsOpen && <DiagnosticsDialog onClose={() => setDiagnosticsOpen(false)} />}
			{bugReportOpen && (
				<BugReportDialog
					sessionId={resolvedSessionId}
					onClose={() => setBugReportOpen(false)}
				/>
			)}
		</main>
	);
};

export default Index;

function SessionRouteSync({
	chatId,
	onSessionReady,
}: {
	chatId: string | null;
	onSessionReady: () => void | Promise<void>;
}) {
	const { sessionId, pendingRouteSync, acknowledgeRouteSync } = useStreamContext();
	const navigate = useNavigate();

	useEffect(() => {
		if (!shouldAdoptPendingSessionRoute(chatId, sessionId, pendingRouteSync)) {
			return;
		}
		acknowledgeRouteSync();
		navigate(`/chat/${sessionId}`, { replace: true });
		void onSessionReady();
	}, [
		chatId,
		sessionId,
		pendingRouteSync,
		acknowledgeRouteSync,
		navigate,
		onSessionReady,
	]);

	return null;
}

function SessionRuntimeLoader({ sessionId, enabled }: { sessionId: string | null; enabled: boolean }) {
	const {
		sessionId: liveSessionId,
		isStreaming,
		messages,
		attachSession,
		detachSession,
		clearMessages,
		loadMessages,
	} = useStreamContext();
	const [sessionMissing, setSessionMissing] = useState(false);
	const hasLiveMessages = messages.length > 0;

	useEffect(() => {
		let cancelled = false;
		const client = getApiClient();
		if (!enabled || !sessionId) {
			setSessionMissing(false);
			detachSession();
			if (!isStreaming) {
				clearMessages(null);
			}
			return;
		}

		if (shouldPreserveLiveSession(sessionId, liveSessionId, isStreaming)) {
			detachSession();
			return;
		}

		if (!shouldHydrateRouteSession(sessionId, liveSessionId, hasLiveMessages)) {
			void attachSession(sessionId);
			return () => {
				cancelled = true;
				detachSession();
			};
		}

		if (liveSessionId !== sessionId) {
			loadMessages([], sessionId);
		}

		const hydrateAndAttach = async () => {
			let missing = false;
			try {
				await ensureApiAuthenticated(client);
				const msgs = await client.getSessionMessages(sessionId);
				if (cancelled) return;

				setSessionMissing(false);
				const converted = hydrateSessionMessages(
					msgs.filter(
						(
							m,
						): m is typeof m & {
							role: "user" | "assistant";
						} => m.role === "user" || m.role === "assistant",
					),
				);
				loadMessages(converted, sessionId, { preservePendingPermissions: true });
			} catch (err) {
				if (!cancelled) {
					if (err instanceof ApiClientError && err.code === "SESSION_NOT_FOUND") {
						missing = true;
						setSessionMissing(true);
						clearMessages(null);
						return;
					}
					console.error("Failed to load session history", err);
				}
			}

			if (cancelled || missing) return;
			void attachSession(sessionId);
		};

		void hydrateAndAttach();

		return () => {
			cancelled = true;
			detachSession();
		};
	}, [
		sessionId,
		enabled,
		liveSessionId,
		hasLiveMessages,
		isStreaming,
		attachSession,
		detachSession,
		clearMessages,
		loadMessages,
	]);

	if (sessionMissing) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
				<div className="text-stone-gray text-sm">Session expired or not found.</div>
				<button
					onClick={() => {
						setSessionMissing(false);
						window.history.replaceState(null, '', '/new');
						window.location.href = '/new';
					}}
					className="rounded-[8px] bg-terracotta px-4 py-2 text-sm text-white hover:bg-terracotta/90 transition-colors"
				>
					Start a new session
				</button>
			</div>
		);
	}

	return null;
}
