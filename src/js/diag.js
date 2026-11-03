/** Ring buffer of Bluetooth diagnostics. Used as a local `console` in bluetooth.js. */
const MAX_LINES = 2000;
const lines = [];

function record(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  lines.push(`${new Date().toISOString()} ${level} ${text}`);
  if (lines.length > MAX_LINES) lines.shift();
}

export const logger = {
  log:   (...a) => { record('INFO ', a); globalThis.console.log(...a); },
  debug: (...a) => { record('DEBUG', a); globalThis.console.debug(...a); },
  warn:  (...a) => { record('WARN ', a); globalThis.console.warn(...a); },
  error: (...a) => { record('ERROR', a); globalThis.console.error(...a); },
};

export function getLogText() {
  return lines.join('\n');
}
