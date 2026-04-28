import { useEffect, useRef, useState } from "react";
import { MessageSquare, Copy, Info } from "lucide-react";

export type SelectionAction = "reply" | "copy" | "explain";

type Props = {
  /** Element whose selections should trigger the tooltip. */
  containerRef: React.RefObject<HTMLElement>;
  onAction: (action: SelectionAction, text: string) => void;
};

export const SelectionTooltip = ({ containerRef, onAction }: Props) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const ttRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseUp = () => {
      // Wait for selection to settle.
      setTimeout(() => {
        const sel = window.getSelection();
        const t = sel?.toString().trim() ?? "";
        if (!sel || t.length < 4) {
          setPos(null);
          return;
        }
        // Ensure selection is inside the container.
        if (!el.contains(sel.anchorNode)) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const ttH = 182;
        const ttW = 200;
        let x = rect.left + rect.width / 2 - ttW / 2;
        let y = rect.top - ttH - 6;
        if (y < 8) y = rect.bottom + 8;
        x = Math.max(8, Math.min(x, window.innerWidth - ttW - 8));

        setText(t);
        setPos({ x, y });
      }, 20);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (ttRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };

    el.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      el.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [containerRef]);

  function handle(a: SelectionAction) {
    onAction(a, text);
    setPos(null);
    window.getSelection()?.removeAllRanges();
  }

  if (!pos) return null;

  return (
    <div
      ref={ttRef}
      className="fixed z-50 bg-near-black border border-[#3a3836] rounded-[10px] p-1 flex flex-col gap-px min-w-[178px] shadow-[0_8px_28px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05)] animate-tt-in"
      style={{ left: pos.x, top: pos.y }}
    >
      <TtBtn icon={<MessageSquare className="w-3 h-3" />} onClick={() => handle("reply")}>
        Reply with quote
      </TtBtn>
      <TtBtn icon={<Copy className="w-3 h-3" />} onClick={() => handle("copy")}>
        Copy selection
      </TtBtn>
      <div className="h-px bg-white/10 mx-2 my-0.5" />
      <TtBtn icon={<Info className="w-3 h-3" />} onClick={() => handle("explain")}>
        Explain this
      </TtBtn>
    </div>
  );
};

const TtBtn = ({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-warm-silver hover:text-ivory text-xs font-sans text-left hover:bg-white/[0.09] transition-colors w-full whitespace-nowrap"
  >
    <span className="opacity-70 group-hover:opacity-100 flex-shrink-0">{icon}</span>
    {children}
  </button>
);
