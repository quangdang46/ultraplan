import { describe, expect, test } from "bun:test";

import {
  buildSessionHistoryResponse,
  buildSessionMessagesFromEvents,
} from "../routes/api/index";

describe("api session history builder", () => {
  test("reconstructs user, assistant, and tool transcript blocks", () => {
    const events = [
      {
        type: "user",
        payload: {
          content: "Read the README",
          quote: {
            text: "Focus on setup",
            sourceRole: "assistant",
          },
        },
        seqNum: 1,
        createdAt: Date.parse("2026-05-01T10:00:00.000Z"),
      },
      {
        type: "tool_start",
        payload: {
          id: "toolu_1",
          name: "Read",
          input: { file_path: "README.md" },
        },
        seqNum: 2,
        createdAt: Date.parse("2026-05-01T10:00:01.000Z"),
      },
      {
        type: "tool_result",
        payload: {
          toolCallId: "toolu_1",
          result: "README contents",
        },
        seqNum: 3,
        createdAt: Date.parse("2026-05-01T10:00:02.000Z"),
      },
      {
        type: "content_delta",
        payload: {
          delta: { type: "text_delta", text: "Done reading." },
        },
        seqNum: 4,
        createdAt: Date.parse("2026-05-01T10:00:03.000Z"),
      },
      {
        type: "message_end",
        payload: {
          id: "msg_1",
        },
        seqNum: 5,
        createdAt: Date.parse("2026-05-01T10:00:04.000Z"),
      },
    ];

    expect(buildSessionMessagesFromEvents(events)).toEqual([
      {
        role: "user",
        content: "Read the README",
        timestamp: "2026-05-01T10:00:00.000Z",
        quote: {
          text: "Focus on setup",
          sourceRole: "assistant",
        },
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-05-01T10:00:01.000Z",
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
        timestamp: "2026-05-01T10:00:02.000Z",
        blocks: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "README contents",
            is_error: false,
          },
        ],
      },
      {
        role: "assistant",
        content: "Done reading.",
        timestamp: "2026-05-01T10:00:03.000Z",
        blocks: [
          {
            type: "text",
            text: "Done reading.",
          },
        ],
      },
    ]);
  });

  test("reports the latest replay cursor for hydrated history", () => {
    const events = [
      {
        type: "user",
        payload: { content: "hello" },
        seqNum: 4,
        createdAt: Date.parse("2026-05-01T10:00:00.000Z"),
      },
      {
        type: "content_delta",
        payload: {
          delta: { type: "text_delta", text: "world" },
        },
        seqNum: 9,
        createdAt: Date.parse("2026-05-01T10:00:01.000Z"),
      },
      {
        type: "message_end",
        payload: { id: "msg_1" },
        seqNum: 12,
        createdAt: Date.parse("2026-05-01T10:00:02.000Z"),
      },
    ];

    expect(buildSessionHistoryResponse(events)).toEqual({
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: "2026-05-01T10:00:00.000Z",
        },
        {
          role: "assistant",
          content: "world",
          timestamp: "2026-05-01T10:00:01.000Z",
          blocks: [
            {
              type: "text",
              text: "world",
            },
          ],
        },
      ],
      lastSeqNum: 12,
    });
  });

  test("treats system clear as a transcript boundary", () => {
    const events = [
      {
        type: "user",
        payload: { content: "before clear" },
        seqNum: 1,
        createdAt: Date.parse("2026-05-01T10:00:00.000Z"),
      },
      {
        type: "content_delta",
        payload: {
          delta: { type: "text_delta", text: "old reply" },
        },
        seqNum: 2,
        createdAt: Date.parse("2026-05-01T10:00:01.000Z"),
      },
      {
        type: "message_end",
        payload: { id: "msg_old" },
        seqNum: 3,
        createdAt: Date.parse("2026-05-01T10:00:02.000Z"),
      },
      {
        type: "system",
        payload: { type: "clear" },
        seqNum: 4,
        createdAt: Date.parse("2026-05-01T10:00:03.000Z"),
      },
      {
        type: "user",
        payload: { content: "after clear" },
        seqNum: 5,
        createdAt: Date.parse("2026-05-01T10:00:04.000Z"),
      },
      {
        type: "content_delta",
        payload: {
          delta: { type: "text_delta", text: "new reply" },
        },
        seqNum: 6,
        createdAt: Date.parse("2026-05-01T10:00:05.000Z"),
      },
      {
        type: "message_end",
        payload: { id: "msg_new" },
        seqNum: 7,
        createdAt: Date.parse("2026-05-01T10:00:06.000Z"),
      },
    ];

    expect(buildSessionHistoryResponse(events)).toEqual({
      messages: [
        {
          role: "user",
          content: "after clear",
          timestamp: "2026-05-01T10:00:04.000Z",
        },
        {
          role: "assistant",
          content: "new reply",
          timestamp: "2026-05-01T10:00:05.000Z",
          blocks: [
            {
              type: "text",
              text: "new reply",
            },
          ],
        },
      ],
      lastSeqNum: 7,
    });
  });
});
