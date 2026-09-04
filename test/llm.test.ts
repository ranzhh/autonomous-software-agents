import { describe, expect, test } from "vitest";
import { z } from "zod";
import { type Fetch, openaiChat, type Tool } from "../src/llm.js";

const tools: Tool[] = [
  {
    name: "go",
    description: "go there",
    parameters: z.object({ x: z.int(), y: z.int() }),
  },
];

/** A server that answers every request with the same message, and keeps what it was sent. */
function server(message: unknown, status = 200) {
  const requests: Record<string, unknown>[] = [];
  const fetcher: Fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(
      status === 200
        ? JSON.stringify({ choices: [{ message }] })
        : "no such model",
      { status },
    );
  };
  return { requests, chat: openaiChat("http://llm", "m", "k", fetcher) };
}

describe("completing a transcript with tools", () => {
  test("sends the catalog as JSON schema and reads the calls back", async () => {
    const { requests, chat } = server({
      content: "",
      tool_calls: [
        {
          id: "c1",
          function: { name: "go", arguments: '{"x":1,"y":2}' },
        },
      ],
    });
    const reply = await chat.complete(
      "be brief",
      [{ role: "user", text: "where?" }],
      tools,
    );

    expect(reply).toEqual({
      text: "",
      calls: [{ id: "c1", name: "go", args: { x: 1, y: 2 } }],
    });
    expect(requests[0]).toMatchObject({
      model: "m",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "where?" },
      ],
      tool_choice: "required",
      tools: [
        {
          type: "function",
          function: {
            name: "go",
            description: "go there",
            parameters: { type: "object", required: ["x", "y"] },
          },
        },
      ],
    });
  });

  test("calls and their results go back on the wire in the OpenAI shape", async () => {
    const { requests, chat } = server({ content: "done" });
    const call = { id: "c1", name: "go", args: { x: 1, y: 2 } };
    const reply = await chat.complete(
      "",
      [
        { role: "user", text: "go" },
        { role: "assistant", text: "", calls: [call] },
        { role: "tool", call, result: "ok" },
      ],
      tools,
    );

    expect(reply).toEqual({ text: "done", calls: [] });
    expect(requests[0]?.messages).toEqual([
      { role: "system", content: "" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "go", arguments: '{"x":1,"y":2}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ]);
  });

  test("arguments already an object, and a call with no id, are read as they come", async () => {
    const { chat } = server({
      content: null,
      tool_calls: [{ function: { name: "go", arguments: { x: 1 } } }],
    });
    const reply = await chat.complete("", [], tools);
    expect(reply.calls).toEqual([{ id: "call-0", name: "go", args: { x: 1 } }]);
  });

  test("a server error is an error, not a silent empty answer", async () => {
    const { chat } = server({}, 404);
    await expect(chat.complete("", [], tools)).rejects.toThrow("404");
  });
});
