/**
 * pddl — automated planning that the BDI invokes when an intention activates.
 * A multi-parcel tour problem (carried + N candidate free parcels + their
 * nearest delivery tiles, abstract complete-graph moves expanded by A*) is
 * built and solved behind a `Solver` interface — remote `onlineSolver`
 * baseline (default) or the optional local pyperplan — then mapped to
 * executable steps as a `PddlPlan` that replans on failure/belief change,
 * with the reactive library as fallback. See ADR-0007 for the formulation.
 */

export { PDDL_DOMAIN, PDDL_DOMAIN_NAME } from "./domain.js";
export {
  buildTourProblem,
  MAX_CANDIDATE_PARCELS,
  type TourCarriedParcel,
  type TourFreeParcel,
  type TourInput,
  type TourProblem,
  type TourSettings,
} from "./problem.js";
