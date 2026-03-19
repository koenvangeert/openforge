import {
  trace,
  debug,
  info,
  warn,
  error,
  attachConsole,
} from '@tauri-apps/plugin-log'

/**
 * Initialize the logging bridge between the Svelte frontend and the Rust
 * backend's `tauri-plugin-log`.
 *
 * - In **dev** mode (`import.meta.env.DEV`), Rust log output is also forwarded
 *   to the browser console via `attachConsole()` so devtools stay useful.
 * - In **all** modes, `console.log/debug/info/warn/error` calls are forwarded
 *   to the Rust log backend so they end up in the on-disk log file.
 */
export async function initLogger(): Promise<void> {
  if (import.meta.env.DEV) {
    await attachConsole()
  }

  const original = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  console.log = (...args: unknown[]) => {
    original.log(...args)
    void trace(formatArgs(args))
  }
  console.debug = (...args: unknown[]) => {
    original.debug(...args)
    void debug(formatArgs(args))
  }
  console.info = (...args: unknown[]) => {
    original.info(...args)
    void info(formatArgs(args))
  }
  console.warn = (...args: unknown[]) => {
    original.warn(...args)
    void warn(formatArgs(args))
  }
  console.error = (...args: unknown[]) => {
    original.error(...args)
    void error(formatArgs(args))
  }
}

/** Collapse variadic console args into a single string for the log backend. */
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
}
