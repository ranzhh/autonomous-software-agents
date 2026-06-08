import { describe, expect, it } from "vitest";
import {
  createLogger,
  emitLogSink,
  type LogContext,
  type LogLevel,
  type LogSink,
  parseLogLevel,
} from "../../../src/core/util/index.js";

interface Entry {
  level: LogLevel;
  message: string;
  context?: LogContext;
}

function captureSink(): { sink: LogSink; entries: Entry[] } {
  const entries: Entry[] = [];
  const sink: LogSink = (level, message, context) => {
    entries.push(
      context === undefined ? { level, message } : { level, message, context },
    );
  };
  return { sink, entries };
}

describe("createLogger", () => {
  it("drops messages below the configured level", () => {
    const { sink, entries } = captureSink();
    const log = createLogger({ level: "warn", sinks: [sink] });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("applies the scope prefix", () => {
    const { sink, entries } = captureSink();
    const log = createLogger({ level: "debug", scope: "agent", sinks: [sink] });
    log.info("hello");
    expect(entries[0]?.message).toBe("[agent] hello");
  });

  it("derives child scopes joined by ':'", () => {
    const { sink, entries } = captureSink();
    const log = createLogger({
      level: "debug",
      scope: "agent",
      sinks: [sink],
    }).child("bdi");
    log.info("hi");
    expect(entries[0]?.message).toBe("[agent:bdi] hi");
  });

  it("forwards structured context to sinks", () => {
    const { sink, entries } = captureSink();
    const log = createLogger({ level: "debug", sinks: [sink] });
    log.error("boom", { code: 42 });
    expect(entries[0]?.context).toEqual({ code: 42 });
  });
});

describe("emitLogSink", () => {
  it("forwards lines to the emit fn with a level tag", () => {
    const calls: unknown[][] = [];
    const sink = emitLogSink((...args) => calls.push(args));
    sink("info", "hello");
    sink("warn", "with-context", { a: 1 });
    expect(calls[0]).toEqual(["[info]", "hello"]);
    expect(calls[1]).toEqual(["[warn]", "with-context", { a: 1 }]);
  });
});

describe("parseLogLevel", () => {
  it("accepts known levels", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("error")).toBe("error");
  });

  it("falls back for unknown or undefined input", () => {
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel(undefined, "warn")).toBe("warn");
  });
});
