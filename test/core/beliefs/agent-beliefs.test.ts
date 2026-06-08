import { describe, expect, it } from "vitest";
import { createAgentBeliefs } from "../../../src/core/beliefs/index.js";

const MY_ID = "me";
const MY_TEAM = "ASAP";
const TTL_MS = 5000;

type Agent = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  x?: number;
  y?: number;
  score: number;
  penalty: number;
};

function agent(id: string, teamName: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    teamId: `tid-${id}`,
    teamName,
    score: 0,
    penalty: 0,
    x: 1,
    y: 1,
    ...over,
  };
}

describe("createAgentBeliefs — upsert", () => {
  it("adds a sensed agent to the store", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("a1", "other")], MY_ID, MY_TEAM, 0);
    expect(ab.all()).toHaveLength(1);
  });

  it("excludes self from the store", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent(MY_ID, MY_TEAM)], MY_ID, MY_TEAM, 0);
    expect(ab.all()).toHaveLength(0);
  });

  it("updates an existing agent on re-sense", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise(
      [agent("a1", "other", { x: 1, y: 1, score: 0 })],
      MY_ID,
      MY_TEAM,
      0,
    );
    ab.revise(
      [agent("a1", "other", { x: 3, y: 5, score: 10 })],
      MY_ID,
      MY_TEAM,
      500,
    );
    const entry = ab.all()[0];
    expect(entry?.x).toBe(3);
    expect(entry?.y).toBe(5);
    expect(entry?.score).toBe(10);
  });
});

describe("createAgentBeliefs — teammate/rival split by teamName", () => {
  it("classifies agents on the same teamName as teammates", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("t1", MY_TEAM), agent("r1", "rivals")], MY_ID, MY_TEAM, 0);
    expect(ab.teammates()).toHaveLength(1);
    expect(ab.teammates()[0]?.id).toBe("t1");
  });

  it("classifies agents on a different teamName as rivals", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("t1", MY_TEAM), agent("r1", "rivals")], MY_ID, MY_TEAM, 0);
    expect(ab.rivals()).toHaveLength(1);
    expect(ab.rivals()[0]?.id).toBe("r1");
  });

  it("uses teamName not teamId for classification", () => {
    const ab = createAgentBeliefs(TTL_MS);
    // Same team name, different teamId (as happens after token re-mint)
    const a = agent("a1", MY_TEAM, { teamId: "different-tid" });
    ab.revise([a], MY_ID, MY_TEAM, 0);
    expect(ab.teammates()).toHaveLength(1);
    expect(ab.rivals()).toHaveLength(0);
  });
});

describe("createAgentBeliefs — last-seen retention", () => {
  it("retains an out-of-view agent within TTL", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("a1", "other")], MY_ID, MY_TEAM, 0);
    // 2nd sensing doesn't see a1 but TTL hasn't expired
    ab.revise([], MY_ID, MY_TEAM, TTL_MS - 1);
    expect(ab.all()).toHaveLength(1);
  });

  it("forgets an agent after TTL expires", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("a1", "other")], MY_ID, MY_TEAM, 0);
    ab.revise([], MY_ID, MY_TEAM, TTL_MS + 1);
    expect(ab.all()).toHaveLength(0);
  });

  it("resets the TTL clock when an agent is seen again", () => {
    const ab = createAgentBeliefs(TTL_MS);
    ab.revise([agent("a1", "other")], MY_ID, MY_TEAM, 0);
    ab.revise([agent("a1", "other")], MY_ID, MY_TEAM, TTL_MS - 1); // re-seen
    ab.revise([], MY_ID, MY_TEAM, TTL_MS + TTL_MS - 2); // TTL_MS-1 after re-seen
    expect(ab.all()).toHaveLength(1);
  });
});

describe("createAgentBeliefs — x/y guard", () => {
  it("stores undefined x/y when agent is out of range", () => {
    const ab = createAgentBeliefs(TTL_MS);
    const a: Agent = {
      id: "a1",
      name: "a1",
      teamId: "t",
      teamName: "other",
      score: 0,
      penalty: 0,
    };
    ab.revise([a], MY_ID, MY_TEAM, 0);
    const entry = ab.all()[0];
    expect(entry?.x).toBeUndefined();
    expect(entry?.y).toBeUndefined();
  });

  it("does not require x/y to be present for upsert", () => {
    const ab = createAgentBeliefs(TTL_MS);
    const a: Agent = {
      id: "a1",
      name: "a1",
      teamId: "t",
      teamName: "other",
      score: 5,
      penalty: 0,
    };
    ab.revise([a], MY_ID, MY_TEAM, 0);
    expect(ab.all()).toHaveLength(1);
  });
});

describe("createAgentBeliefs — empty state", () => {
  it("returns empty arrays before first revise", () => {
    const ab = createAgentBeliefs(TTL_MS);
    expect(ab.all()).toHaveLength(0);
    expect(ab.teammates()).toHaveLength(0);
    expect(ab.rivals()).toHaveLength(0);
  });
});
