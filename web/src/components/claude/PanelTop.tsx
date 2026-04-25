import { ChevronDown, BarChart3, PanelLeft } from "lucide-react";

type Props = {
  title: string;
  diagramsOpen: boolean;
  onToggleDiagrams: () => void;
  onOpenSidebar?: () => void;
};

export const PanelTop = ({ title, diagramsOpen, onToggleDiagrams, onOpenSidebar }: Props) => (
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
      <h1 className="font-serif-display text-[14px] text-near-black flex items-center gap-1 truncate min-w-0 cursor-pointer">
        {title}
        <ChevronDown className="w-2.5 h-2.5 text-stone-gray font-sans" />
      </h1>
    </div>

    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        onClick={onToggleDiagrams}
        className={`flex items-center gap-1.5 rounded-[7px] px-[10px] py-1 text-[11.5px] font-medium font-sans whitespace-nowrap transition-all border ${
          diagramsOpen
            ? "bg-near-black text-ivory border-near-black shadow-[0_0_0_1px_hsl(var(--near-black))]"
            : "bg-warm-sand text-charcoal-warm border-border-warm shadow-ring hover:shadow-ring-strong hover:bg-[#dedad4]"
        }`}
      >
        <BarChart3 className="w-3 h-3" />
        Diagrams
      </button>

      <div className="text-[11px] text-stone-gray flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#7ec47a] flex-shrink-0" />
        idle · 2 days ago
      </div>
    </div>
  </div>
);
