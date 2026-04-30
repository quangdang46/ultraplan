import { useEffect } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { keys: "Enter", description: "Send message" },
  { keys: "Shift + Enter", description: "New line" },
  { keys: "Esc", description: "Cancel / close dialog" },
  { keys: "@ + filename", description: "Mention a file" },
  { keys: "/ + command", description: "Slash command" },
  { keys: "↑ / ↓", description: "Navigate suggestions" },
  { keys: "Tab", description: "Accept suggestion" },
  { keys: "Ctrl + Shift + F", description: "Search workspace" },
  { keys: "Ctrl + Shift + H", description: "Prompt history" },
  { keys: "Ctrl + Shift + B", description: "Bug report" },
  { keys: "?", description: "Toggle this help" },
];

export function KeyboardShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border-cream bg-ivory p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif-display text-[15px] font-semibold text-near-black">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-stone-gray hover:text-near-black transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-charcoal-warm">{s.description}</span>
              <kbd className="rounded-md border border-border-warm bg-warm-sand px-2 py-0.5 font-mono text-[10.5px] text-near-black">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
