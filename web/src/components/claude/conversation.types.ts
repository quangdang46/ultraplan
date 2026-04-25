export type ToolItem = {
  id: string;
  title: string;           // e.g., "Bash (ls -la)" or "Read (package.json)"
  kind: string;             // Generic tool name: "Bash", "Read", "Edit", "Grep", "Glob", etc.
  status: "done" | "running" | "failed";

  // Running state info
  elapsedMs?: number;      // e.g., 2000 for "Running… (2s)"
  outputLines?: string[];  // Last 5 lines during streaming

  // Completed state info
  output?: string;        // Full stdout
  stderr?: string;         // Error output (red)
  cwdWarning?: string;      // "Shell cwd was reset..." warning
  exitCode?: number;       // 0 for success, non-zero for error

  // Time display format: "(0.1s · +3 lines)" or "(2s)"
  timeDisplay?: string;
};