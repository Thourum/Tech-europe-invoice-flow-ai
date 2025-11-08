import pino, { stdTimeFunctions, type Logger } from 'pino';
import pretty from 'pino-pretty';

const level = process.env.NODE_ENV === 'production' ? 'error' : 'trace';

export type AppLogger = Logger;
export type LoggerBindings = { logger: AppLogger };
export type AppEnv = { Variables: LoggerBindings };

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level,
    base: undefined,
    timestamp: stdTimeFunctions.isoTime,
  },
  isDev
    ? pretty({
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      })
    : undefined
);

export function createRequestLogger(
  bindings: Record<string, unknown>
): AppLogger {
  return logger.child(bindings);
}
