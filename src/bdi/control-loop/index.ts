/**
 * bdi/control-loop — the agent's top-level cycle, wiring beliefs to plans:
 * every belief update re-deliberates, a switch stops the running plan and
 * starts the new one, and a finished plan resets the commitment and
 * re-deliberates at once. Kept out of the entrypoints so both Agent A and
 * Agent B drive standard play with the same loop, and so its preemption
 * bookkeeping (generation tokens over singleton plans) is unit-testable.
 */

export {
  type ControlLoop,
  type ControlLoopDeps,
  createControlLoop,
  type Deliberator,
} from "./control-loop.js";
