/**
 * logger.js
 * Tiny levelled logger. Silenced in production except errors.
 */
import { env } from '../config/env.js';

const PREFIX = '%c[GITM]';
const STYLE = 'color:#22e1ff;font-weight:600';

function fmt(level, args) {
  return [PREFIX, STYLE, `[${level}]`, ...args];
}

export const logger = {
  debug: (...a) => env.IS_DEV && console.debug(...fmt('dbg', a)),
  info: (...a) => env.IS_DEV && console.info(...fmt('info', a)),
  warn: (...a) => console.warn(...fmt('warn', a)),
  error: (...a) => console.error(...fmt('err', a)),
};
