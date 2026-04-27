import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/claude/Sidebar";
import { PanelTop } from "@/components/claude/PanelTop";
import { Conversation } from "@/components/claude/Conversation";
import { MermaidPanel } from "@/components/claude/MermaidPanel";
import { ActionBar } from "@/components/claude/ActionBar";
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
import { getApiClient } from "@/api/client";
import type { Message } from "@/features/chat/types";
import { ensureApiAuthenticated } from "@/features/chat/streamTransport";
import { useSessions } from "@/hooks/useSessions";
import { useLocation, useNavigate, useParams } from "react-router-dom";

const Index = () => {
	const [diagramsOpen, setDiagramsOpen] = useState(false);
	const [renderToken, setRenderToken] = useState(0);
	const [quote, setQuote] = useState<string | null>(null);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
	const [activeSession, setActiveSession] = useState<Session | null>(null);
	const desktopContentRef = useRef<HTMLDivElement>(null);
	const mobileContentRef = useRef<HTMLDivElement>(null);
	const [isMobile, setIsMobile] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	const { chatId } = useParams<{ chatId?: string }>();
	const { sessions, loading, error, refetch, createSession, killSession, renameSession } = useSessions();

	useEffect(() => {
		if (location.pathname === "/") {
			navigate("/new", { replace: true });
		}
	}, [location.pathname, navigate]);
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

	function handleSelectionAction(action: SelectionAction, text: string) {
		if (action === "reply") {
			setQuote(text);
		} else if (action === "copy") {
			navigator.clipboard.writeText(text).catch(() => {});
		} else if (action === "explain") {
			const short = text.length > 60 ? text.slice(0, 60) + "…" : text;
			setQuote(`Explain: "${short}"`);
		} else if (action === "visualize") {
			if (!diagramsOpen) setDiagramsOpen(true);
			setRenderToken((t) => t + 1);
		}
	}

	function handleSessionSelect(session: Session) {
		setActiveSession(session);
		navigate(`/chat/${session.id}`);
	}

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
								<PanelTop
									title={activeSession?.title ?? "Select a session"}
									diagramsOpen={diagramsOpen}
									onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
								/>

								<div className="flex-1 min-h-0 w-full overflow-hidden">
									<ResizablePanelGroup direction="horizontal">
										<ResizablePanel defaultSize={diagramsOpen ? 72 : 100} minSize={45}>
											<StreamProvider key={activeSession?.id ?? 'none'}>
												<SessionRuntimeLoader sessionId={activeSession?.id ?? null} enabled={!isMobile} />
												<div className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden">
													<div
														ref={desktopContentRef}
														className="flex-1 min-h-0 overflow-y-auto px-6 py-5 scrollbar-warm"
													>
														<Conversation />
													</div>

													<ActionBar
														quote={quote}
														onClearQuote={() => setQuote(null)}
														sessionId={activeSession?.id}
													/>
												</div>
											</StreamProvider>
										</ResizablePanel>

										{diagramsOpen && (
											<>
												<ResizableHandle withHandle className="bg-border-warm/70" />
												<ResizablePanel defaultSize={28} minSize={20} maxSize={55}>
													<MermaidPanel
														onClose={() => setDiagramsOpen(false)}
														renderToken={renderToken}
													/>
												</ResizablePanel>
											</>
										)}
									</ResizablePanelGroup>
								</div>
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
								<PanelTop
									title={activeSession?.title ?? "Select a session"}
									diagramsOpen={diagramsOpen}
									onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
								/>

								<div className="flex-1 min-h-0 w-full overflow-hidden">
									<ResizablePanelGroup direction="horizontal">
										<ResizablePanel defaultSize={diagramsOpen ? 72 : 100} minSize={45}>
											<StreamProvider key={activeSession?.id ?? 'none'}>
												<SessionRuntimeLoader sessionId={activeSession?.id ?? null} enabled={!isMobile} />
												<div className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden">
													<div
														ref={desktopContentRef}
														className="flex-1 min-h-0 overflow-y-auto px-6 py-5 scrollbar-warm"
													>
														<Conversation />
													</div>

													<ActionBar
														quote={quote}
														onClearQuote={() => setQuote(null)}
														sessionId={activeSession?.id}
													/>
												</div>
											</StreamProvider>
										</ResizablePanel>

										{diagramsOpen && (
											<>
												<ResizableHandle withHandle className="bg-border-warm/70" />
												<ResizablePanel defaultSize={28} minSize={20} maxSize={55}>
													<MermaidPanel
														onClose={() => setDiagramsOpen(false)}
														renderToken={renderToken}
													/>
												</ResizablePanel>
											</>
										)}
									</ResizablePanelGroup>
								</div>
							</section>
						</ResizablePanel>
					</ResizablePanelGroup>
				)}
			</div>
			)}

			{/* Mobile */}
			{isMobile && (
			<div className="h-full bg-ivory">
				<section className="flex h-full flex-col min-h-0">
					<PanelTop
						title={activeSession?.title ?? "Select a session"}
						diagramsOpen={diagramsOpen}
						onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
						onOpenSidebar={() => setMobileSidebarOpen(true)}
					/>
					<StreamProvider key={activeSession?.id ?? 'none'}>
						<SessionRuntimeLoader sessionId={activeSession?.id ?? null} enabled={isMobile} />
						<div className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden">
							<div
								ref={mobileContentRef}
								className="flex-1 min-h-0 overflow-y-auto px-4 py-4 scrollbar-warm"
							>
								<Conversation />
							</div>
							<ActionBar
								quote={quote}
								onClearQuote={() => setQuote(null)}
								sessionId={activeSession?.id}
							/>
						</div>
					</StreamProvider>
				</section>

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
		</main>
	);
};

export default Index;

function SessionRuntimeLoader({ sessionId, enabled }: { sessionId: string | null; enabled: boolean }) {
	const { attachSession, detachSession, loadMessages } = useStreamContext();

	useEffect(() => {
		let cancelled = false;
		const client = getApiClient();
		if (!enabled || !sessionId) {
			detachSession();
			loadMessages([]);
			return;
		}

		const hydrateAndAttach = async () => {
			try {
				await ensureApiAuthenticated(client);
				const msgs = await client.getSessionMessages(sessionId);
				if (cancelled) return;

				const converted: Message[] = msgs
					.filter(
						(
							m,
						): m is typeof m & {
							role: "user" | "assistant";
						} => m.role === "user" || m.role === "assistant",
					)
					.map((m, index) => ({
						id: `history_${m.timestamp}_${index}`,
						role: m.role,
						content: m.content,
						toolCalls: [],
					}));
				loadMessages(converted);
			} catch (err) {
				if (!cancelled) {
					console.error("Failed to load session history", err);
				}
			}

			if (cancelled) return;
			void attachSession(sessionId);
		};

		void hydrateAndAttach();

		return () => {
			cancelled = true;
			detachSession();
		};
	}, [sessionId, enabled, attachSession, detachSession, loadMessages]);

	return null;
}
