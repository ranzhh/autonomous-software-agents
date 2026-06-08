/**
 * A small leveled logger. Messages below the configured level are dropped; the
 * rest are dispatched to one or more sinks. The default sink writes to the
 * console; `emitLogSink` bridges to the SDK's `socket.emitLog` so lines also show
 * in the 3D client. A logger carries an optional `scope` (e.g. "bdi-agent") that
 * prefixes every line, and `child()` derives a sub-scoped logger.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Structured key/value context attached to a log line. */
export type LogContext = Readonly<Record<string, unknown>>;

export type LogSink = (
  level: LogLevel,
  message: string,
  context?: LogContext,
) => void;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger whose scope is this one's scope plus `scope` (joined by ":"). */
  child(scope: string): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly scope?: string;
  readonly sinks?: readonly LogSink[];
}

const CONSOLE_METHODS: Readonly<
  Record<LogLevel, (...args: unknown[]) => void>
> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** Default sink: writes to the matching `console` method. */
export const consoleSink: LogSink = (level, message, context) => {
  const write = CONSOLE_METHODS[level];
  if (context === undefined) {
    write(message);
  } else {
    write(message, context);
  }
};

/** Bridges log lines to the SDK's `socket.emitLog`, so they show in the 3D client. */
export const emitLogSink =
  (emit: (...args: unknown[]) => void): LogSink =>
  (level, message, context) => {
    if (context === undefined) {
      emit(`[${level}]`, message);
    } else {
      emit(`[${level}]`, message, context);
    }
  };

export function createLogger(options?: LoggerOptions): Logger {
  const level = options?.level ?? "info";
  const sinks = options?.sinks ?? [consoleSink];
  const scope = options?.scope;
  const threshold = LEVEL_ORDER[level];

  const emit = (
    messageLevel: LogLevel,
    message: string,
    context?: LogContext,
  ): void => {
    if (LEVEL_ORDER[messageLevel] < threshold) {
      return;
    }
    const line = scope !== undefined ? `[${scope}] ${message}` : message;
    for (const sink of sinks) {
      sink(messageLevel, line, context);
    }
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (subScope) =>
      createLogger({
        level,
        sinks,
        scope: scope !== undefined ? `${scope}:${subScope}` : subScope,
      }),
  };
}

/** Parse a string into a `LogLevel`, falling back when it isn't a known level. */
export function parseLogLevel(
  value: string | undefined,
  fallback: LogLevel = "info",
): LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value ?? "")
    ? (value as LogLevel)
    : fallback;
}
