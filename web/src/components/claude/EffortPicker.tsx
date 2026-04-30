import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Brain } from "lucide-react";

const EFFORTS = [
  { id: "low", label: "Low", description: "Fast, less thorough" },
  { id: "medium", label: "Medium", description: "Balanced" },
  { id: "high", label: "High", description: "Deep reasoning" },
];

type Props = {
  effort: string;
  onChange: (effort: string) => void;
};

export function EffortPicker({ effort, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[1];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-border-warm bg-warm-sand px-2 py-1 text-[11px] font-medium text-charcoal-warm hover:bg-[#ede8e0] transition-colors"
        title="Thinking effort"
      >
        <Brain className="h-3 w-3" />
        {current.label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-border-cream bg-ivory shadow-lg overflow-hidden">
          {EFFORTS.map((e) => (
            <button
              key={e.id}
              onClick={() => { onChange(e.id); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-warm-sand transition-colors"
            >
              <div>
                <div className="text-[12.5px] font-medium text-near-black">{e.label}</div>
                <div className="text-[10.5px] text-stone-gray">{e.description}</div>
              </div>
              {e.id === effort && <Check className="h-3.5 w-3.5 text-terracotta" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
