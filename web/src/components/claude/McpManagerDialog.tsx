import { useEffect, useState } from "react";
import { Server, Plus, Trash2, X, ChevronDown, ChevronRight } from "lucide-react";
import { getApiClient } from "../../api/client";

interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: string;
}

type Props = {
  onClose: () => void;
};

export function McpManagerDialog({ onClose }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", command: "", args: "", env: "" });
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  const load = async (projectCwd: string) => {
    setLoading(true);
    try {
      const client = getApiClient();
      const data = await client.getMcpServers(projectCwd);
      setServers(data.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch the project cwd from the state endpoint
    const client = getApiClient();
    void client.getState().then((state) => {
      setCwd(state.cwd);
      void load(state.cwd);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleAdd = async () => {
    if (!cwd) return;
    setError(null);
    if (!form.name.trim() || !form.command.trim()) {
      setError("Name and command are required");
      return;
    }

    const args = form.args.trim()
      ? form.args.split(/\s+/)
      : [];

    const env: Record<string, string> = {};
    if (form.env.trim()) {
      for (const line of form.env.split("\n")) {
        const [key, ...rest] = line.split("=");
        if (key?.trim()) env[key.trim()] = rest.join("=").trim();
      }
    }

    try {
      await getApiClient().addMcpServer(form.name.trim(), form.command.trim(), cwd, args, env);
      setForm({ name: "", command: "", args: "", env: "" });
      setAdding(false);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    }
  };

  const handleDelete = async (name: string) => {
    if (!cwd) return;
    try {
      await getApiClient().deleteMcpServer(name, cwd);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-cream">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-near-black">
            <Server className="w-4 h-4 text-stone-gray" />
            MCP Servers
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1 text-[11.5px] text-terracotta hover:text-coral transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
            <button onClick={onClose} className="text-stone-gray hover:text-charcoal-warm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Add form */}
        {adding && (
          <div className="px-4 py-3 border-b border-border-cream bg-warm-sand/40">
            <div className="space-y-2">
              {error && <div className="text-[11px] text-red-600">{error}</div>}
              <input
                placeholder="Server name (e.g. filesystem)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-border-warm bg-white px-3 py-1.5 text-[12px] text-olive-gray outline-none focus:border-terracotta/50"
              />
              <input
                placeholder="Command (e.g. npx @modelcontextprotocol/server-filesystem)"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                className="w-full rounded-lg border border-border-warm bg-white px-3 py-1.5 text-[12px] text-olive-gray font-mono outline-none focus:border-terracotta/50"
              />
              <input
                placeholder="Args (space-separated, optional)"
                value={form.args}
                onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                className="w-full rounded-lg border border-border-warm bg-white px-3 py-1.5 text-[12px] text-olive-gray font-mono outline-none focus:border-terracotta/50"
              />
              <textarea
                placeholder={"Env vars (KEY=VALUE, one per line, optional)"}
                value={form.env}
                onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-border-warm bg-white px-3 py-1.5 text-[12px] text-olive-gray font-mono outline-none focus:border-terracotta/50 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleAdd()}
                  className="px-3 py-1.5 rounded-lg bg-terracotta text-white text-[12px] hover:bg-coral transition-colors"
                >
                  Add server
                </button>
                <button
                  onClick={() => { setAdding(false); setError(null); }}
                  className="px-3 py-1.5 rounded-lg border border-border-warm text-[12px] text-stone-gray hover:text-charcoal-warm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Server list */}
        <div className="flex-1 overflow-y-auto scrollbar-warm-thin">
          {loading && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">Loading…</div>
          )}
          {!loading && servers.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-stone-gray">
              No MCP servers configured. Add one to get started.
            </div>
          )}
          {!loading && servers.map((srv) => (
            <div key={srv.name} className="border-b border-border-cream last:border-b-0">
              <div className="flex items-center gap-2 px-4 py-3">
                <button
                  onClick={() => setExpanded((v) => v === srv.name ? null : srv.name)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                >
                  {expanded === srv.name
                    ? <ChevronDown className="w-3 h-3 text-stone-gray flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-stone-gray flex-shrink-0" />
                  }
                  <span className="text-[13px] font-medium text-near-black">{srv.name}</span>
                  <span className="text-[10.5px] text-stone-gray ml-1 truncate">{srv.command}</span>
                </button>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-warm-sand text-charcoal-warm flex-shrink-0">
                  {srv.status}
                </span>
                <button
                  onClick={() => void handleDelete(srv.name)}
                  className="text-stone-gray hover:text-red-500 transition-colors flex-shrink-0"
                  aria-label={`Delete ${srv.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {expanded === srv.name && (
                <div className="px-4 pb-3 pl-9">
                  <div className="bg-warm-sand/40 rounded-lg p-2.5 font-mono text-[11px] text-olive-gray">
                    <div>{srv.command}</div>
                    {srv.args.length > 0 && (
                      <div className="text-stone-gray mt-0.5">args: {srv.args.join(" ")}</div>
                    )}
                    {Object.keys(srv.env).length > 0 && (
                      <div className="text-stone-gray mt-0.5">
                        env: {Object.keys(srv.env).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
