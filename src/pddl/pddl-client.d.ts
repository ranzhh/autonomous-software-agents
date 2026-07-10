/**
 * Minimal ambient types for `@unitn-asa/pddl-client` (the package ships no
 * TypeScript declarations). Only the surface we use is declared — the
 * `onlineSolver` remote baseline. Shapes verified against the 1.7.7 source
 * (`src/PddlOnlineSolver.js`): resolves to `undefined` when no plan is found;
 * action/args come back upper-cased by the solver (CLAUDE.md §6).
 */

declare module "@unitn-asa/pddl-client" {
  export interface PddlClientPlanStep {
    parallel: boolean;
    action: string;
    args: string[];
  }

  export function onlineSolver(
    pddlDomain: string,
    pddlProblem: string,
  ): Promise<PddlClientPlanStep[] | undefined>;
}
