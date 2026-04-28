import type { SessionMessage } from "../../api/types";
import { toToolResultText } from "./streamParser";
import type { Message, ToolItem } from "./types";

function formatToolTitle(name: string, input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  const preview = serialized.length > 50 ? `${serialized.slice(0, 50)}...` : serialized;
  return `${name} - ${preview}`;
}

function buildToolItem(block: NonNullable<SessionMessage["blocks"]>[number]): ToolItem | null {
  if (block.type !== "tool_use" || !block.id) return null;
  const input =
    block.input && typeof block.input === "object"
      ? (block.input as Record<string, unknown>)
      : {};
  const name = typeof block.name === "string" ? block.name : "Tool";
  return {
    id: block.id,
    title: formatToolTitle(name, input),
    kind: name,
    status: "done",
    outputLines: [],
  };
}

function attachToolResult(messages: Message[], block: NonNullable<SessionMessage["blocks"]>[number]): boolean {
  if (block.type !== "tool_result") return false;
  const toolCallId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
  if (!toolCallId) return false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const toolIndex = message.toolCalls.findIndex((tool) => tool.id === toolCallId);
    if (toolIndex === -1) continue;

    const updatedTools = [...message.toolCalls];
    const output = toToolResultText(block.content);
    updatedTools[toolIndex] = {
      ...updatedTools[toolIndex],
      status: block.is_error ? "failed" : "done",
      output,
      exitCode: block.is_error ? 1 : 0,
      outputLines: output ? output.split("\n").slice(-5) : [],
    };
    messages[i] = {
      ...message,
      toolCalls: updatedTools,
    };
    return true;
  }

  return false;
}

export function hydrateSessionMessages(sessionMessages: SessionMessage[]): Message[] {
  const hydrated: Message[] = [];

  sessionMessages.forEach((sessionMessage, index) => {
    const blocks = sessionMessage.blocks ?? [];

    if (sessionMessage.role === "user") {
      const toolResultBlocks = blocks.filter((block) => block.type === "tool_result");
      const hasOnlyToolResults = blocks.length > 0 && toolResultBlocks.length === blocks.length;

      if (hasOnlyToolResults) {
        toolResultBlocks.forEach((block) => {
          if (attachToolResult(hydrated, block)) return;
          const output = toToolResultText(block.content);
          hydrated.push({
            id: `history_tool_result_${sessionMessage.timestamp}_${index}_${block.tool_use_id ?? "unknown"}`,
            role: "assistant",
            content: "",
            toolCalls: [{
              id: block.tool_use_id ?? `tool_result_${index}`,
              title: `Tool result - ${block.tool_use_id ?? "unknown"}`,
              kind: "tool_result",
              status: block.is_error ? "failed" : "done",
              output,
              exitCode: block.is_error ? 1 : 0,
              outputLines: output ? output.split("\n").slice(-5) : [],
            }],
          });
        });
        return;
      }

      const content =
        sessionMessage.content ||
        blocks
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text!.trim())
          .filter(Boolean)
          .join("\n");

      if (!content && !sessionMessage.quote?.text) return;

      hydrated.push({
        id: `history_user_${sessionMessage.timestamp}_${index}`,
        role: "user",
        content,
        toolCalls: [],
        quote: sessionMessage.quote,
      });
      return;
    }

    if (sessionMessage.role !== "assistant") return;

    const toolCalls = blocks
      .map((block) => buildToolItem(block))
      .filter((tool): tool is ToolItem => tool !== null);
    const thinking = blocks
      .filter(
        (block): block is typeof block & { type: "thinking"; thinking: string } =>
          block.type === "thinking" && typeof block.thinking === "string",
      )
      .map((block) => block.thinking.trim())
      .filter(Boolean)
      .join("\n\n");
    const content =
      sessionMessage.content ||
      blocks
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text!.trim())
        .filter(Boolean)
        .join("\n");

    if (!content && !thinking && toolCalls.length === 0) return;

    hydrated.push({
      id: `history_assistant_${sessionMessage.timestamp}_${index}`,
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      toolCalls,
    });

    blocks.forEach((block) => {
      if (block.type === "tool_result") {
        void attachToolResult(hydrated, block);
      }
    });
  });

  return hydrated;
}
