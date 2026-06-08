/**
 * Per-agent belief revision. Teammates are identified by `teamName`
 * (CLAUDE.md §6: `teamId` is re-randomized on every mint — never use it).
 * The sensing agent itself is excluded. Agents that were in view are updated;
 * those that drop out of view are retained until a configurable TTL expires, at
 * which point they are forgotten. `IOAgent.x`/`.y` are optional (undefined when
 * the agent is out of view) — guarded throughout.
 */

export interface AgentEntry {
  readonly id: string;
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  /** Last-known x coordinate (`undefined` when never seen in range). */
  readonly x: number | undefined;
  /** Last-known y coordinate (`undefined` when never seen in range). */
  readonly y: number | undefined;
  readonly score: number;
  readonly penalty: number;
  /** `Date.now()`-style timestamp of the last sensing update. */
  readonly lastSeenAt: number;
}

type RawAgent = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  x?: number | undefined;
  y?: number | undefined;
  score: number;
  penalty: number;
};

export interface AgentBeliefs {
  /**
   * Revise beliefs from one sensing snapshot.
   * @param agents      The agents from `IOSensing`.
   * @param myId        My agent id — excluded from the store.
   * @param myTeamName  My team name — used to split teammates from rivals.
   * @param now         Current timestamp in ms (injectable for tests).
   */
  revise(
    agents: ReadonlyArray<RawAgent>,
    myId: string,
    myTeamName: string,
    now: number,
  ): void;

  /** Agents on the same team (by `teamName`), excluding self. */
  teammates(): readonly AgentEntry[];

  /** Agents on a different team. */
  rivals(): readonly AgentEntry[];

  /** All believed agents (teammates + rivals). */
  all(): readonly AgentEntry[];
}

/** Default TTL: forget an unseen agent after 30 s. */
const DEFAULT_TTL_MS = 30_000;

/**
 * Create a mutable `AgentBeliefs` store.
 * @param agentTtlMs  How long (ms) to retain an out-of-view agent. Defaults to 30 s.
 */
export function createAgentBeliefs(agentTtlMs = DEFAULT_TTL_MS): AgentBeliefs {
  const store = new Map<string, AgentEntry>();
  let myTeamNameRef: string | undefined;

  function revise(
    agents: ReadonlyArray<RawAgent>,
    myId: string,
    myTeamName: string,
    now: number,
  ): void {
    myTeamNameRef = myTeamName;

    // Upsert every sensed agent (excluding self).
    const sensedIds = new Set<string>();
    for (const a of agents) {
      if (a.id === myId) continue;
      sensedIds.add(a.id);
      store.set(a.id, {
        id: a.id,
        name: a.name,
        teamId: a.teamId,
        teamName: a.teamName,
        x: a.x,
        y: a.y,
        score: a.score,
        penalty: a.penalty,
        lastSeenAt: now,
      });
    }

    // Expire agents not seen within the TTL.
    for (const [id, entry] of store) {
      if (sensedIds.has(id)) continue;
      if (now - entry.lastSeenAt > agentTtlMs) {
        store.delete(id);
      }
    }
  }

  function all(): readonly AgentEntry[] {
    return Array.from(store.values());
  }

  function teammates(): readonly AgentEntry[] {
    const team = myTeamNameRef;
    return all().filter((a) => a.teamName === team);
  }

  function rivals(): readonly AgentEntry[] {
    const team = myTeamNameRef;
    return all().filter((a) => a.teamName !== team);
  }

  return { revise, all, teammates, rivals };
}
