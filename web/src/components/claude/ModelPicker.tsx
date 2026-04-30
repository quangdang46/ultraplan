import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6", description: "Most capable" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Balanced" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: "Fastest" },
];

type Props = {
  model: string;
  onChange: (model: string) => void;
};

export function ModelPicker({ model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = MODELS.find((m) => m.id === model) ?? MODELS[1];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-border-warm bg-warm-sand px-2 py-1 text-[11px] font-medium text-charcoal-warm hover:bg-[#ede8e0] transition-colors"
      >
        {current.label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border border-border-cream bg-ivory shadow-lg overflow-hidden">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => { onChange(m.id); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-warm-sand transition-colors"
            >
              <div>
                <div className="text-[12.5px] font-medium text-near-black">{m.label}</div>
                <div className="text-[10.5px] text-stone-gray">{m.description}</div>
              </div>
              {m.id === model && <Check className="h-3.5 w-3.5 text-terracotta" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
