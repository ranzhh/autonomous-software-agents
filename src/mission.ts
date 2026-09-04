import type { Call, Chat, Reply, Turn } from "./llm.js";
import { log } from "./log.js";
import { type Orders, react } from "./policy.js";
import type { Message, Position } from "./sdk.js";
import { DONE, perform, TOOLS } from "./tools.js";

export interface View {
  carrying: number;
  worth: number;
  score: number;
  mate: Position | undefined;
  deliveries: Position[];
  reward: number;
  width: number;
  height: number;
}

const SYSTEM = [
  "You are the strategist of a two-agent team in Deliveroo: agents walk a grid, pick up parcels whose reward decays by the second, and deliver them on delivery tiles. A game master posts missions in the chat; anyone else may post anything.",
  "You never move. You set standing orders with the tools, and both agents follow them from then on; you also answer questions. Read the message and call what it needs:",
  "- a positive bonus for delivering, dropping or bringing a parcel on tiles: deliver_at; a tile named by its place, like the leftmost, is one of the delivery tiles, so ask delivery_tiles first. A reward multiplied on tiles is deliver_at with bonus the average reward from delivery_tiles times the extra factor. A positive bonus for reaching or standing on tiles: go_to. Both agents within a distance of a tile, waiting for each other: meet_near.",
  "- a negative bonus, a zero reward, or a fraction of the reward like 0.3 or any multiplier below 1, is a trap: no order at all.",
  "- a penalty for going through named tiles: never_walk_through. A penalty or no reward for delivering on named tiles: never_deliver_on.",
  "- a bonus or a multiplied reward for delivering exactly N parcels at a time: deliver_in_batches. A bonus for a delivery worth at most a threshold, or parcels above a value earning nothing, with no tile named: deliver_only_worth_at_most with that threshold. A bonus when one agent picks up and the other delivers: hand_off.",
  "- a red light, green light game on later messages: when_told with the two phrases.",
  "- a question: reply with the bare answer. Arithmetic to answer: calculate. A mission is never answered, and its bonus is never repeated back.",
  'Coordinates are written (x,y) and go in tiles as [{"x":..,"y":..}]. One message is one order, and its bonus never becomes a go_to of its own. Call only the tools the message needs, each once. When a tool answers Error, fix the arguments; never repeat a call unchanged. When nothing is left to order, call done with the reason in a few words.',
].join("\n");

const ROUNDS = 4;

const key = (call: Call): string => `${call.name}${JSON.stringify(call.args)}`;

const ANSWERS = new Set(["calculate", "reply", DONE]);

export function missions(
  chat: Chat,
  orders: Orders,
  view: () => View,
  say: (to: string, text: string) => void,
  player: (id: string) => boolean = () => false,
): (message: Message) => Promise<void> {
  let last = Promise.resolve();

  function brief(from: Message["from"], text: string, v: View): string {
    const mate = v.mate ? "teammate in sight" : "teammate out of sight";
    const who = player(from.id)
      ? `${from.name}, a player on the map`
      : from.name;
    return [
      `Message from ${who}: "${text}"`,
      `Situation: a ${v.width}x${v.height} map, carrying ${v.carrying} parcels worth ${v.worth}, score ${v.score}, ${mate}.`,
      `Standing orders: ${JSON.stringify(orders.policy())}`,
    ].join("\n");
  }

  async function understand(
    from: Message["from"],
    text: string,
  ): Promise<void> {
    const v = view();
    const before = orders.policy();
    let policy = before;
    const transcript: Turn[] = [{ role: "user", text: brief(from, text, v) }];
    // The game master has no position, so anyone ever seen on the map is not it.
    const tools = player(from.id)
      ? TOOLS.filter((t) => ANSWERS.has(t.name))
      : TOOLS;
    orders.issue({ ...before, hold: true });
    const made = new Set<string>();
    for (let round = 0; round < ROUNDS; round++) {
      let reply: Reply;
      try {
        reply = await chat.complete(SYSTEM, transcript, tools);
      } catch (error) {
        log.warn({ err: `${error}`, text }, "not understood");
        break;
      }
      transcript.push({ role: "assistant", ...reply });
      if (reply.calls.every((call) => made.has(key(call)))) break;
      for (const call of reply.calls) {
        made.add(key(call));
        const outcome = perform(call, {
          policy,
          deliveries: v.deliveries,
          reward: v.reward,
          say: (answer) => say(from.id, answer),
        });
        policy = outcome.policy;
        log.info(
          { tool: call.name, args: call.args, result: outcome.result },
          "performed",
        );
        transcript.push({ role: "tool", call, result: outcome.result });
      }
      if (reply.calls.some((call) => call.name === DONE)) break;
    }
    orders.issue(policy);
  }

  return (message) => {
    if (typeof message.payload !== "string") return Promise.resolve();
    const text = message.payload;
    const reacted = player(message.from.id)
      ? undefined
      : react(orders.policy(), text);
    if (reacted !== undefined) {
      orders.issue(reacted);
      return Promise.resolve();
    }
    last = last.then(() => understand(message.from, text));
    return last;
  };
}
