export interface DevToolsWindowLike {
  webContents: {
    openDevTools(options: { mode: 'detach' }): void
  }
}

export function shouldOpenDevTools(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPENFORGE_ELECTRON_DEVTOOLS === '0') return false
  if (env.OPENFORGE_ELECTRON_DEVTOOLS === '1') return true
  return Boolean(env.ELECTRON_RENDERER_URL)
}

export function openDevToolsForDevelopment(
  window: DevToolsWindowLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!shouldOpenDevTools(env)) return false
  window.webContents.openDevTools({ mode: 'detach' })
  return true
}
