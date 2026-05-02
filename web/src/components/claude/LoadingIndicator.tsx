import { useEffect, useRef, useState } from "react";

const SPINNER_FRAMES = ["·", "✢", "✱", "✶", "✻", "✽"];
const SPINNER_CYCLE = [...SPINNER_FRAMES, ...SPINNER_FRAMES.slice().reverse()];

interface LoadingIndicatorProps {
  verb?: string;
  stalled?: boolean;
}

export function LoadingIndicator({
  verb = "Thinking",
  stalled = false,
}: LoadingIndicatorProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_CYCLE.length);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    startTimeRef.current = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5 py-2">
      <span
        className="min-w-[1.2em] text-xl leading-none transition-colors duration-2000"
        style={{ color: stalled ? "var(--color-status-error)" : "var(--color-brand)" }}
      >
        {SPINNER_CYCLE[frame]}
      </span>
      <span className="glimmer-text text-sm font-medium text-charcoal-warm">
        {verb}...
      </span>
      <span className="ml-auto font-mono text-xs text-stone-gray">
        {elapsed}s
      </span>
    </div>
  );
}
