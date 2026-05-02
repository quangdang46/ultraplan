import { useState, useRef, useEffect } from "react";
import { Shield, ChevronDown, Check } from "lucide-react";

const PERMISSION_MODES = [
  { id: "default", label: "Default", description: "Ask before tools" },
  { id: "acceptEdits", label: "Accept Edits", description: "Approve Edit without asking" },
  { id: "plan", label: "Plan", description: "Review before changes" },
  { id: "bypassPermissions", label: "Bypass", description: "Skip all prompts" },
  { id: "auto", label: "Auto", description: "AI decides approvals" },
];

type Props = {
  permissionMode: string;
  onChange: (mode: string) => void;
};

export function PermissionModePicker({ permissionMode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = PERMISSION_MODES.find((m) => m.id === permissionMode) ?? PERMISSION_MODES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-border-warm bg-warm-sand px-2 py-1 text-[11px] font-medium text-charcoal-warm hover:bg-[#ede8e0] transition-colors"
        title="Permission mode"
      >
        <Shield className="h-3 w-3" />
        {current.label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-border-cream bg-ivory shadow-lg overflow-hidden">
          {PERMISSION_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => { onChange(m.id); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-warm-sand transition-colors"
            >
              <div>
                <div className="text-[12.5px] font-medium text-near-black">{m.label}</div>
                <div className="text-[10.5px] text-stone-gray">{m.description}</div>
              </div>
              {m.id === permissionMode && <Check className="h-3.5 w-3.5 text-terracotta" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
