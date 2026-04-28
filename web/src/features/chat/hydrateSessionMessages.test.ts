import { describe, expect, test } from "vitest";
import { hydrateSessionMessages } from "./hydrateSessionMessages";
import type { SessionMessage } from "../../api/types";

describe("hydrateSessionMessages", () => {
  test("preserves assistant tool history from structured session blocks", () => {
    const messages: SessionMessage[] = [
      {
        role: "assistant",
        content: "",
        timestamp: "2026-04-28T00:00:00.000Z",
        blocks: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { file_path: "README.md" },
          },
        ],
      },
      {
        role: "user",
        content: "",
        timestamp: "2026-04-28T00:00:01.000Z",
        blocks: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "contents here",
          },
        ],
      },
    ];

    const hydrated = hydrateSessionMessages(messages);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.role).toBe("assistant");
    expect(hydrated[0]?.toolCalls).toHaveLength(1);
    expect(hydrated[0]?.toolCalls[0]).toMatchObject({
      id: "toolu_1",
      kind: "Read",
      status: "done",
      output: "contents here",
    });
  });

  test("keeps user text messages when structured blocks are absent", () => {
    const hydrated = hydrateSessionMessages([
      {
        role: "user",
        content: "hello",
        timestamp: "2026-04-28T00:00:00.000Z",
      },
    ]);

    expect(hydrated).toEqual([
      {
        id: "history_user_2026-04-28T00:00:00.000Z_0",
        role: "user",
        content: "hello",
        toolCalls: [],
        quote: undefined,
      },
    ]);
  });

  test("hydrates assistant thinking blocks alongside final text", () => {
    const hydrated = hydrateSessionMessages([
      {
        role: "assistant",
        content: "",
        timestamp: "2026-04-28T00:00:02.000Z",
        blocks: [
          {
            type: "thinking",
            thinking: "First, inspect the repo.",
          },
          {
            type: "text",
            text: "Here is the answer.",
          },
        ],
      },
    ]);

    expect(hydrated).toEqual([
      {
        id: "history_assistant_2026-04-28T00:00:02.000Z_0",
        role: "assistant",
        content: "Here is the answer.",
        thinking: "First, inspect the repo.",
        toolCalls: [],
      },
    ]);
  });
});
