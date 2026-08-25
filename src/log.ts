import { pino } from "pino";

// NDJSON on stdout, pretty-printed at read time: a transport worker can drop
// buffered lines when the process exits on a signal.
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
