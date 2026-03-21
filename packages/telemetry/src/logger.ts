export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): Logger;
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export function createLogger(service: string, level?: LogLevel): Logger {
  const minLevel = LEVELS.indexOf(
    level || (process.env.LOG_LEVEL as LogLevel) || "info",
  );

  function log(
    lvl: LogLevel,
    msg: string,
    baseMeta: Record<string, unknown>,
    callMeta?: Record<string, unknown>,
  ) {
    const lvlIdx = LEVELS.indexOf(lvl);
    if (lvlIdx < minLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level: lvl,
      service,
      msg,
      ...baseMeta,
      ...callMeta,
    };
    process.stderr.write(JSON.stringify(entry) + "\n");
  }

  function buildLogger(baseMeta: Record<string, unknown>): Logger {
    return {
      debug: (msg, meta) => log("debug", msg, baseMeta, meta),
      info: (msg, meta) => log("info", msg, baseMeta, meta),
      warn: (msg, meta) => log("warn", msg, baseMeta, meta),
      error: (msg, meta) => log("error", msg, baseMeta, meta),
      child: (childMeta) => buildLogger({ ...baseMeta, ...childMeta }),
    };
  }

  return buildLogger({});
}
