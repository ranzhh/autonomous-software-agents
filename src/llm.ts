import { z } from "zod";
import { log } from "./log.js";

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodType;
}

export interface Call {
  id: string;
  name: string;
  args: unknown;
}

export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: Call[] }
  | { role: "tool"; call: Call; result: string };

export interface Reply {
  text: string;
  calls: Call[];
}

export interface Chat {
  complete(system: string, transcript: Turn[], tools: Tool[]): Promise<Reply>;
}

export type Fetch = typeof fetch;

const TIMEOUT_MS = 60_000;

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const Completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().default(""),
        tool_calls: z
          .array(
            z.object({
              id: z.string().default(""),
              function: z.object({
                name: z.string(),
                arguments: z
                  .unknown()
                  .transform((a) => (typeof a === "string" ? json(a) : a)),
              }),
            }),
          )
          .default([]),
      }),
    }),
  ),
});

function wire(system: string, transcript: Turn[]): unknown[] {
  return [
    { role: "system", content: system },
    ...transcript.map((turn) =>
      turn.role === "user"
        ? { role: "user", content: turn.text }
        : turn.role === "tool"
          ? { role: "tool", tool_call_id: turn.call.id, content: turn.result }
          : {
              role: "assistant",
              content: turn.text,
              tool_calls: turn.calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            },
    ),
  ];
}

export function openaiChat(
  url: string,
  model: string,
  key: string,
  fetcher: Fetch = fetch,
): Chat {
  return {
    async complete(system, transcript, tools) {
      const startedAt = Date.now();
      const response = await fetcher(`${url}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: wire(system, transcript),
          tool_choice: "required",
          tools: tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: z.toJSONSchema(t.parameters, { io: "input" }),
            },
          })),
          temperature: 0,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(
          `${model} answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      const choice = Completion.parse(await response.json()).choices[0];
      if (choice === undefined) throw new Error(`${model} answered nothing`);
      const { message } = choice;
      const reply: Reply = {
        text: message.content ?? "",
        calls: message.tool_calls.map((c, i) => ({
          id: c.id || `call-${i}`,
          name: c.function.name,
          args: c.function.arguments,
        })),
      };
      log.info({ model, ms: Date.now() - startedAt, ...reply }, "completed");
      return reply;
    },
  };
}
