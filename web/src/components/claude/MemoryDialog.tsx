import { useEffect, useState } from "react";
import { BookOpen, Save, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getApiClient } from "../../api/client";

interface MemoryFile {
  path: string;
  content: string;
}

type Props = {
  cwd?: string | null;
  onClose: () => void;
};

export function MemoryDialog({ cwd, onClose }: Props) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getApiClient().getMemoryFiles(cwd ?? undefined);
      setFiles(data.files);
      const nextActiveFile =
        data.files.find((file) => file.path === activeFile) ?? data.files[0] ?? null;
      setActiveFile(nextActiveFile?.path ?? null);
      setEditContent(nextActiveFile?.content ?? "");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [cwd]);

  const handleFileSelect = (file: MemoryFile) => {
    setActiveFile(file.path);
    setEditContent(file.content);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      await getApiClient().saveMemoryFile(activeFile, editContent, cwd ?? undefined);
      setFiles((prev) =>
        prev.map((f) => f.path === activeFile ? { ...f, content: editContent } : f)
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl bg-ivory rounded-2xl border border-border-cream shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-cream">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-near-black">
            <BookOpen className="w-4 h-4 text-stone-gray" />
            Memory Files
          </div>
          <button onClick={onClose} className="text-stone-gray hover:text-charcoal-warm">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar: file list */}
          <div className="w-44 flex-shrink-0 border-r border-border-cream overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="w-4 h-4 animate-spin text-stone-gray" />
              </div>
            )}
            {!loading && files.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-stone-gray">
                No CLAUDE.md files found.
              </div>
            )}
            {!loading && files.map((file) => (
              <button
                key={file.path}
                onClick={() => handleFileSelect(file)}
                className={`w-full text-left px-3 py-2.5 border-b border-border-cream last:border-b-0 text-[11.5px] flex items-center gap-1 transition-colors ${
                  activeFile === file.path
                    ? "bg-terracotta/10 text-terracotta"
                    : "text-charcoal-warm hover:bg-warm-sand"
                }`}
              >
                {activeFile === file.path
                  ? <ChevronDown className="w-3 h-3 flex-shrink-0" />
                  : <ChevronRight className="w-3 h-3 flex-shrink-0" />
                }
                <span className="truncate font-mono">{file.path.split("/").pop()}</span>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {activeFile ? (
              <>
                <div className="flex items-center justify-between px-3 py-2 border-b border-border-cream bg-warm-sand/30">
                  <span className="text-[11px] font-mono text-stone-gray truncate">
                    {activeFile}
                  </span>
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="flex items-center gap-1 text-[11.5px] text-terracotta hover:text-coral disabled:opacity-50 transition-colors"
                  >
                    {saving
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Save className="w-3 h-3" />
                    }
                    {saved ? "Saved!" : "Save"}
                  </button>
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => { setEditContent(e.target.value); setSaved(false); }}
                  className="flex-1 w-full min-h-0 resize-none px-4 py-3 font-mono text-[12px] text-olive-gray outline-none bg-white"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                      e.preventDefault();
                      void handleSave();
                    }
                  }}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-stone-gray">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
