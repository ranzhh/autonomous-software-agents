import { createHash } from "node:crypto";
import { env } from "./env.js";

// mulberry32: the same generator the server patch uses, uniform in [0, 1).
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random stream derived from SEED, the agent's NAME and `name`, so two
 * agents of the same kind in one run draw differently. Plain Math.random
 * when SEED is unset.
 */
export function randomStream(
  name: string,
  seed = env.SEED,
  who = env.NAME,
): () => number {
  if (seed === undefined || seed === "") return Math.random;
  const digest = createHash("sha256").update(`${seed}:${who}:${name}`).digest();
  return mulberry32(digest.readUInt32LE(0));
}
