import { pino } from "pino";
import { env } from "./env.js";

// NDJSON on stdout, pretty-printed at read time: a transport worker can drop
// buffered lines when the process exits on a signal.
export const log = pino({ level: env.LOG_LEVEL });
