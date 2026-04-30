import { useEffect, useState } from "react";
import { X, CheckCircle2, XCircle, Loader2, Stethoscope, RefreshCw } from "lucide-react";
import { getApiClient } from "../../api/client";

type CheckStatus = "pending" | "ok" | "error";

interface Check {
  name: string;
  detail: string;
  status: CheckStatus;
}

function useChecks() {
  const [checks, setChecks] = useState<Check[]>([
    { name: "API reachable", detail: "", status: "pending" },
    { name: "Authentication", detail: "", status: "pending" },
    { name: "Session state", detail: "", status: "pending" },
    { name: "Tools available", detail: "", status: "pending" },
    { name: "MCP servers", detail: "", status: "pending" },
    { name: "Memory files", detail: "", status: "pending" },
  ]);

  const update = (name: string, status: CheckStatus, detail: string) => {
    setChecks((prev) =>
      prev.map((c) => (c.name === name ? { ...c, status, detail } : c))
    );
  };

  const run = async () => {
    setChecks((prev) => prev.map((c) => ({ ...c, status: "pending", detail: "" })));
    const client = getApiClient();

    // 1. API reachable
    try {
      await client.authValidate();
      update("API reachable", "ok", "Backend responded");
    } catch {
      update("API reachable", "error", "Cannot reach backend");
    }

    // 2. Authentication
    try {
      const r = await client.authValidate();
      if (r.valid) {
        update("Authentication", "ok", "Token valid");
      } else {
        update("Authentication", "error", "Token invalid or expired");
      }
    } catch {
      update("Authentication", "error", "Auth check failed");
    }

    // 3. Session state
    try {
      const state = await client.getState();
      update("Session state", "ok", `model: ${state.model ?? "unknown"}, cwd: ${state.cwd ?? "?"}`);
    } catch {
      update("Session state", "error", "Could not load state");
    }

    // 4. Tools available
    try {
      const tools = await client.getTools();
      const count = Array.isArray(tools.tools) ? tools.tools.length : 0;
      update("Tools available", count > 0 ? "ok" : "error", `${count} tools registered`);
    } catch {
      update("Tools available", "error", "Could not load tools");
    }

    // 5. MCP servers
    try {
      const mcp = await client.getMcpServers();
      const count = mcp.servers.length;
      update("MCP servers", "ok", count === 0 ? "No servers configured" : `${count} server(s) configured`);
    } catch {
      update("MCP servers", "error", "Could not load MCP config");
    }

    // 6. Memory files
    try {
      const mem = await client.getMemoryFiles();
      const count = mem.files.length;
      update("Memory files", "ok", count === 0 ? "No CLAUDE.md files found" : `${count} file(s) found`);
    } catch {
      update("Memory files", "error", "Could not load memory files");
    }
  };

  return { checks, run };
}

export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const { checks, run } = useChecks();

  useEffect(() => {
    void run();
  }, []);

  const allDone = checks.every((c) => c.status !== "pending");
  const hasError = checks.some((c) => c.status === "error");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-cream">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-near-black">
            <Stethoscope className="w-4 h-4 text-stone-gray" />
            Diagnostics
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void run()}
              className="flex items-center gap-1 text-[11.5px] text-terracotta hover:text-coral transition-colors"
              title="Re-run checks"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-run
            </button>
            <button onClick={onClose} className="text-stone-gray hover:text-charcoal-warm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary banner */}
        {allDone && (
          <div className={`px-4 py-2 text-[11.5px] font-medium border-b border-border-cream ${
            hasError ? "bg-red-50 text-red-700" : "bg-[#f0faf0] text-[#2d7a2d]"
          }`}>
            {hasError ? "Some checks failed — see details below." : "All checks passed."}
          </div>
        )}

        {/* Check list */}
        <div className="flex-1 overflow-y-auto divide-y divide-border-cream">
          {checks.map((check) => (
            <div key={check.name} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5 flex-shrink-0">
                {check.status === "pending" && <Loader2 className="w-4 h-4 animate-spin text-stone-gray" />}
                {check.status === "ok" && <CheckCircle2 className="w-4 h-4 text-[#4caf50]" />}
                {check.status === "error" && <XCircle className="w-4 h-4 text-red-500" />}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-near-black">{check.name}</div>
                {check.detail && (
                  <div className={`text-[11px] mt-0.5 ${check.status === "error" ? "text-red-600" : "text-stone-gray"}`}>
                    {check.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
