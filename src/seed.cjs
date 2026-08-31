// Preloaded via NODE_OPTIONS into the game server and the raced agents.
// SEED pins every Math.random draw: spawn tiles, parcel placement, reward
// rolls, wander steps. Neither the server nor the agents seed themselves.
const seed = Number(process.env.SEED);
if (Number.isFinite(seed)) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
