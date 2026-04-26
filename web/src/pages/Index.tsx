import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/claude/Sidebar";
import { PanelTop } from "@/components/claude/PanelTop";
import { Conversation } from "@/components/claude/Conversation";
import { MermaidPanel } from "@/components/claude/MermaidPanel";
import { ActionBar } from "@/components/claude/ActionBar";
import { StreamProvider } from "@/hooks/useStreamContext";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
	SelectionTooltip,
	type SelectionAction,
} from "@/components/claude/SelectionTooltip";
import { sessions } from "@/data/claudeCode";

const Index = () => {
	const [activeId, setActiveId] = useState(9);
	const [diagramsOpen, setDiagramsOpen] = useState(false);
	const [renderToken, setRenderToken] = useState(0);
	const [quote, setQuote] = useState<string | null>(null);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
	const desktopContentRef = useRef<HTMLDivElement>(null);
	const mobileContentRef = useRef<HTMLDivElement>(null);
	const [isMobile, setIsMobile] = useState(false);

	const active = sessions.find((s) => s.id === activeId)!;

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 767px)");
		const sync = () => setIsMobile(mq.matches);
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

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

	return (
		<main className="w-full overflow-hidden shadow-window h-screen">
			{/* Desktop */}
			<div className="hidden md:block h-full">
				{desktopSidebarCollapsed ? (
					<div className="h-full bg-parchment flex">
						<div className="w-[64px] flex-shrink-0">
							<Sidebar
								activeId={activeId}
								onSelect={setActiveId}
								collapsed
								onToggleCollapse={() => setDesktopSidebarCollapsed(false)}
							/>
						</div>
						<div className="flex-1 min-w-0">
							<section className="flex h-full flex-col bg-ivory min-h-0">
								<PanelTop
									title={active.title}
									diagramsOpen={diagramsOpen}
									onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
								/>

								<div className="flex-1 min-h-0 w-full overflow-hidden">
									<ResizablePanelGroup direction="horizontal">
										<ResizablePanel defaultSize={diagramsOpen ? 72 : 100} minSize={45}>
											<StreamProvider>
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
								activeId={activeId}
								onSelect={setActiveId}
								collapsed={false}
								onToggleCollapse={() => setDesktopSidebarCollapsed(true)}
							/>
						</ResizablePanel>
						<ResizableHandle withHandle className="bg-border-warm/70" />

						<ResizablePanel defaultSize={76} minSize={64}>
							<section className="flex h-full flex-col bg-ivory min-h-0">
								<PanelTop
									title={active.title}
									diagramsOpen={diagramsOpen}
									onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
								/>

								<div className="flex-1 min-h-0 w-full overflow-hidden">
									<ResizablePanelGroup direction="horizontal">
										<ResizablePanel defaultSize={diagramsOpen ? 72 : 100} minSize={45}>
											<StreamProvider>
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

			{/* Mobile */}
			<div className="md:hidden h-full bg-ivory">
				<section className="flex h-full flex-col min-h-0">
					<PanelTop
						title={active.title}
						diagramsOpen={diagramsOpen}
						onToggleDiagrams={() => setDiagramsOpen((v) => !v)}
						onOpenSidebar={() => setMobileSidebarOpen(true)}
					/>
					<StreamProvider>
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
							activeId={activeId}
							onSelect={(id) => {
								setActiveId(id);
								setMobileSidebarOpen(false);
							}}
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

			<SelectionTooltip
				containerRef={isMobile ? mobileContentRef : desktopContentRef}
				onAction={handleSelectionAction}
			/>
		</main>
	);
};

export default Index;
