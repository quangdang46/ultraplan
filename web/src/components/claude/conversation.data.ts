import type { ToolItem } from "./conversation.types";

// Mock data matching CLI tool display format:
// - Running: "● Bash (command)" + "Running… (0:02)" + last 5 output lines
// - Completed: "✓ Bash (command)" + stdout + stderr (red) + cwdWarning + "(0.1s · +3 lines)"

export const tools: ToolItem[] = [
  // Shell command - running state
  {
    id: "shell-ls-running",
    title: "Bash (ls -la /data/projects/ultraplan)",
    kind: "Bash",
    status: "running",
    elapsedMs: 2000,
    outputLines: [
      "drwxr-xr-x  quangdang  staff   320 Apr 25 22:00",
      "drwxr-xr-x  quangdang  staff   160 Apr 25 22:05",
      "-rw-r--r--  quangdang  staff  6148 Apr 25 23:00",
      "-rw-r--r--  quangdang  staff  2048 Apr 25 23:15",
    ],
  },

  // Shell command - completed with time display
  {
    id: "shell-ls-done",
    title: "Bash (ls -la /data/projects/ultraplan)",
    kind: "Bash",
    status: "done",
    output: "drwxr-xr-x  quangdang  staff   320 Apr 25 22:00\ndrwxr-xr-x  quangdang  staff   160 Apr 25 22:05\n-rw-r--r--  quangdang  staff  6148 Apr 25 23:00\n-rw-r--r--  quangdang  staff  2048 Apr 25 23:15",
    exitCode: 0,
    timeDisplay: "(0.1s · +4 lines)",
  },

  // Shell command with stderr
  {
    id: "shell-grep-error",
    title: "Grep (grep -r \"TODO\" src/)",
    kind: "Grep",
    status: "done",
    output: "",
    stderr: "grep: src/: No such file or directory",
    exitCode: 2,
    timeDisplay: "(0.05s)",
  },

  // Shell command with cwd warning
  {
    id: "shell-cwd-warning",
    title: "Bash (cd /tmp && ls)",
    kind: "Bash",
    status: "done",
    output: "file1.txt  file2.txt  temp/",
    stderr: "",
    cwdWarning: "Shell cwd was reset to /data/projects/ultraplan",
    exitCode: 0,
    timeDisplay: "(0.08s · +3 lines)",
  },

  // Read tool - completed
  {
    id: "read-file-done",
    title: "Read (package.json)",
    kind: "Read",
    status: "done",
    output: '{\n  "name": "claude-code-best",\n  "version": "1.10.2",\n  "type": "module"\n}',
    exitCode: 0,
    timeDisplay: "(0.02s)",
  },

  // Edit tool - completed
  {
    id: "edit-file-done",
    title: "Edit (src/App.tsx)",
    kind: "Edit",
    status: "done",
    output: "--- Modified src/App.tsx ---\n+ Added useEffect for initialization\n+ Fixed memory leak in cleanup",
    exitCode: 0,
    timeDisplay: "(0.15s)",
  },

  // Bash command - failed
  {
    id: "shell-npm-error",
    title: "Bash (npm run build)",
    kind: "Bash",
    status: "failed",
    output: "",
    stderr: "npm ERR! code ENOENT\nnpm ERR! syscall spawn npm\nnpm ERR! path /data/projects/ultraplan\nnpm ERR! working directory /data/projects/ultraplan",
    exitCode: 1,
    timeDisplay: "(0.3s)",
  },

  // Glob tool - completed
  {
    id: "glob-done",
    title: "Glob (src/**/*.tsx)",
    kind: "Glob",
    status: "done",
    output: "src/components/claude/Conversation.tsx\nsrc/components/claude/Sidebar.tsx\nsrc/pages/Index.tsx\nsrc/components/claude/ActionBar.tsx",
    exitCode: 0,
    timeDisplay: "(0.1s · +4 files)",
  },

  // WebFetch tool - completed
  {
    id: "web-fetch-done",
    title: "WebFetch (api.example.com/status)",
    kind: "WebFetch",
    status: "done",
    output: '{"status": "ok", "version": "1.0.0", "uptime": 86400}',
    exitCode: 0,
    timeDisplay: "(0.25s)",
  },

  // Agent tool - completed
  {
    id: "agent-done",
    title: "Agent (plan-agent)",
    kind: "Agent",
    status: "done",
    output: "Planning task completed with 3 subtasks created:\n- Implement backend API\n- Update web UI components\n- Add integration tests",
    exitCode: 0,
    timeDisplay: "(1.2s · +3 subtasks)",
  },
];