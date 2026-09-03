import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { env } from "../src/env.js";
import { solve } from "../src/solver.js";

const DOMAIN = `(define (domain toy)
  (:requirements :strips)
  (:predicates (a) (b))
  (:action go :precondition (a) :effect (and (b) (not (a)))))`;

const problem = (init: string, goal: string) =>
  `(define (problem t) (:domain toy) (:init ${init}) (:goal ${goal}))`;

const available = spawnSync(env.FAST_DOWNWARD, ["--version"]).status === 0;

describe.skipIf(!available)("the local solver", () => {
  test("returns one action line per step", { timeout: 30_000 }, async () => {
    expect(await solve(DOMAIN, problem("(a)", "(b)"))).toMatch(/\(go\s*\)/);
  });

  test("answers undefined when there is no plan", {
    timeout: 30_000,
  }, async () => {
    expect(await solve(DOMAIN, problem("(b)", "(a)"))).toBeUndefined();
  });
});
