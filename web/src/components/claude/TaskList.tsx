import { useStreamContext } from "../../hooks/useStreamContext";
import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";

export function TaskList() {
  const { messages } = useStreamContext();

  // Extract task tool calls from all messages
  const tasks = messages.flatMap((msg) =>
    msg.toolCalls.filter((t) =>
      t.kind === "TaskCreate" || t.kind === "TaskUpdate" || t.kind === "task_create" || t.kind === "task_update"
    )
  );

  // Build task map from structured tool inputs instead of the preview title.
  const taskMap = new Map<string, { id: string; subject: string; status: string }>();
  for (const t of tasks) {
    const input = t.input;
    if (!input) continue;

    const id = String(input.taskId ?? input.id ?? t.id);
    const existing = taskMap.get(id);
    const subject =
      typeof input.subject === "string" && input.subject.trim()
        ? input.subject
        : typeof input.description === "string" && input.description.trim()
          ? input.description
          : typeof input.title === "string" && input.title.trim()
            ? input.title
            : existing?.subject ?? id;
    const rawStatus =
      typeof input.status === "string"
        ? input.status
        : t.kind?.toLowerCase().includes("create")
          ? "pending"
          : existing?.status ?? "unknown";
    const status = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");

    taskMap.set(id, { id, subject, status });
  }

  const taskList = Array.from(taskMap.values());

  if (taskList.length === 0) {
    return (
      <div className="px-1 py-2 text-[11.5px] text-stone-gray italic">
        No tasks tracked in this session.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {taskList.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}

function TaskRow({ task }: { task: { id: string; subject: string; status: string } }) {
  const { icon, color } = getStatusMeta(task.status);
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-warm-sand/50 transition-colors">
      <span className={`mt-0.5 flex-shrink-0 ${color}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-near-black leading-[1.4] break-words">{task.subject}</div>
        <div className="text-[10px] text-stone-gray capitalize">{task.status}</div>
      </div>
    </div>
  );
}

function getStatusMeta(status: string): { icon: React.ReactNode; color: string } {
  switch (status) {
    case "completed":
      return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-[#7ec47a]" };
    case "in_progress":
      return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: "text-terracotta" };
    case "deleted":
      return { icon: <XCircle className="h-3.5 w-3.5" />, color: "text-stone-gray" };
    default:
      return { icon: <Circle className="h-3.5 w-3.5" />, color: "text-stone-gray" };
  }
}
