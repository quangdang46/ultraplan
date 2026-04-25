import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { BarChart3, X, Play, ArrowUp, Sparkles } from "lucide-react";
import { diagramDefs } from "@/data/claudeCode";

let initialized = false;
function ensureMermaidInit() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      primaryColor: "#faf9f5",
      primaryBorderColor: "#c96442",
      primaryTextColor: "#141413",
      lineColor: "#87867f",
      secondaryColor: "#f5f4ed",
      tertiaryColor: "#e8e6dc",
      background: "#ffffff",
      mainBkg: "#faf9f5",
      nodeBorder: "#d1cfc5",
      clusterBkg: "#f5f4ed",
      titleColor: "#141413",
      edgeLabelBackground: "#f5f4ed",
      fontFamily: '"DM Sans", system-ui, sans-serif',
      fontSize: "13px",
    },
  });
}

type Props = {
  onClose: () => void;
  /** Token incremented when user clicks "Render all" or "Visualize as diagram" to trigger a render. */
  renderToken?: number;
};

export const MermaidPanel = ({ onClose, renderToken = 0 }: Props) => {
  const [rendered, setRendered] = useState<{ label: string; svg: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoTriggered = useRef(false);

  // Auto-render when first opened
  useEffect(() => {
    if (!autoTriggered.current) {
      autoTriggered.current = true;
      void renderAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render on explicit token change
  useEffect(() => {
    if (renderToken > 0) {
      void renderAll();
      bodyRef.current?.scrollTo({ top: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderToken]);

  async function renderAll() {
    ensureMermaidInit();
    setLoading(true);
    const out: { label: string; svg: string }[] = [];
    for (let i = 0; i < diagramDefs.length; i++) {
      const d = diagramDefs[i];
      try {
        const id = `mm-${i}-${Date.now()}`;
        const { svg } = await mermaid.render(id, d.code);
        out.push({ label: d.label, svg });
      } catch (e) {
        out.push({
          label: d.label,
          svg: `<div style="color:#b53333;font-size:11.5px;padding:6px;font-family:monospace;">Render error: ${(e as Error).message}</div>`,
        });
      }
    }
    setRendered(out);
    setLoading(false);
  }

  return (
    <div className="h-full w-full min-w-0 bg-parchment flex flex-col overflow-hidden">
      <div className="px-[13px] pt-[10px] pb-2 border-b border-border-cream flex items-center justify-between flex-shrink-0">
        <div className="text-xs font-semibold text-near-black flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-terracotta" />
          Diagrams
        </div>
        <button
          onClick={onClose}
          aria-label="Close diagrams"
          className="w-[22px] h-[22px] flex items-center justify-center rounded-[5px] text-stone-gray hover:bg-warm-sand hover:text-near-black transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 scrollbar-warm-thin"
      >
        {loading && !rendered && (
          <div className="p-4 text-xs text-stone-gray text-center">Rendering diagrams…</div>
        )}

        {!rendered && !loading && (
          <div className="px-4 py-7 text-center">
            <div className="text-[28px] mb-2.5">📊</div>
            <p className="text-[12.5px] text-stone-gray leading-[1.6]">
              <strong className="text-charcoal-warm">Diagram panel</strong>
              <br /><br />
              Select any text in the conversation and choose
              <br />
              <strong className="text-charcoal-warm">"Visualize as diagram"</strong> — or click below
              <br />
              to render all diagrams for this session.
            </p>
            <button
              onClick={() => void renderAll()}
              className="mt-4 mx-auto flex items-center gap-1.5 bg-near-black text-ivory border-near-black rounded-[7px] px-[10px] py-1 text-[11.5px] font-medium shadow-[0_0_0_1px_hsl(var(--near-black))]"
            >
              <Play className="w-3 h-3" />
              Render all diagrams
            </button>
          </div>
        )}

        {rendered?.map((d, i) => (
          <div
            key={i}
            className="bg-white border border-border-cream rounded-[10px] px-3 pt-3.5 pb-3 mb-2.5 overflow-x-auto"
          >
            <div className="text-[10.5px] text-stone-gray font-semibold tracking-wider uppercase mb-2.5 flex items-center gap-1.5 before:content-[''] before:w-[3px] before:h-[3px] before:bg-terracotta before:rounded-full">
              {d.label}
            </div>
            <div
              className="[&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: d.svg }}
            />
          </div>
        ))}
      </div>

      {/* Bottom chat panel — ask about diagrams */}
      <div className="border-t border-border-warm bg-parchment px-2.5 pt-2 pb-2.5 flex-shrink-0">
        <div className="text-[10px] text-stone-gray font-semibold tracking-wider uppercase mb-1.5 flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-terracotta" />
          Ask about diagrams
        </div>
        <div className="relative">
          <input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="Refine or ask…"
            className="w-full bg-white border border-border-warm rounded-[9px] px-2.5 py-1.5 pr-9 text-[12px] text-olive-gray font-sans outline-none focus:border-terracotta/50 focus:shadow-[0_0_0_1.5px_hsl(var(--terracotta)/0.15)] transition-all placeholder:text-stone-gray"
          />
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-[22px] h-[22px] bg-terracotta hover:bg-coral rounded-md text-white flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
