import pino, { stdTimeFunctions, type Logger } from 'pino';

const level = process.env.NODE_ENV === 'production' ? 'error' : 'trace';

export type AppLogger = Logger;
export type LoggerBindings = { logger: AppLogger };
export type AppEnv = { Variables: LoggerBindings };

export const logger = pino({
  level,
  base: undefined,
  timestamp: stdTimeFunctions.isoTime
});

export function createRequestLogger(
  bindings: Record<string, unknown>
): AppLogger {
  return logger.child(bindings);
}

