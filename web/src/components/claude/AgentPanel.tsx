import { useStreamContext } from "../../hooks/useStreamContext";

function formatElapsed(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function AgentPanel({ onClose }: { onClose?: () => void }) {
  const { messages } = useStreamContext();

  // Collect all Agent tool calls across all messages
  const agentCalls = messages.flatMap((msg) =>
    msg.toolCalls.filter((tc) => tc.kind === "Agent")
  );

  if (agentCalls.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px] text-stone-gray text-center">
        No active sub-agents.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border-cream">
      {agentCalls.map((agent) => (
        <div key={agent.id} className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  agent.status === "running"
                    ? "bg-amber-400 animate-pulse"
                    : agent.status === "done"
                      ? "bg-[#4caf50]"
                      : "bg-red-400"
                }`}
              />
              <span className="text-[11.5px] font-medium text-near-black truncate">
                Agent
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {agent.status === "running" && agent.elapsedMs !== undefined && (
                <span className="text-[10px] text-stone-gray">{formatElapsed(agent.elapsedMs)}</span>
              )}
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  agent.status === "running"
                    ? "bg-amber-100 text-amber-700"
                    : agent.status === "done"
                      ? "bg-[#e8f5e9] text-[#2d7a2d]"
                      : "bg-red-50 text-red-600"
                }`}
              >
                {agent.status}
              </span>
            </div>
          </div>
          {agent.outputLines.length > 0 && (
            <div className="mt-1 text-[10px] font-mono text-stone-gray truncate pl-3.5">
              {agent.outputLines[agent.outputLines.length - 1]}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
