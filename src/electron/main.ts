import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createMainWindowOptions } from './windowConfig.js'
import { openDevToolsForDevelopment } from './devTools.js'
import { createPreloadPath } from './preloadPath.js'
import { loadAndRevealMainWindow } from './windowStartup.js'
import { asChildProcessLike, createSidecarLaunchConfig, startSidecar } from './sidecar.js'
import { handleElectronInvoke } from './backendBridge.js'
import { createAppEventForwarder } from './eventForwarder.js'
import { trustedRendererUrlFromEnv } from './rendererUrl.js'
import type { AppEventForwarder } from './eventForwarder.js'
import type { SidecarHandle } from './sidecar.js'

let sidecar: SidecarHandle | null = null
let appEventForwarder: AppEventForwarder | null = null

function currentDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = createPreloadPath(currentDir())
  const window = new BrowserWindow(createMainWindowOptions(preloadPath))

  const rendererUrl = trustedRendererUrlFromEnv()
  console.log(`[electron] Loading renderer from ${rendererUrl ?? 'packaged dist/index.html'}`)
  await loadAndRevealMainWindow(window, rendererUrl
    ? { rendererUrl }
    : { filePath: join(currentDir(), '..', 'dist', 'index.html') })
  if (openDevToolsForDevelopment(window)) {
    console.log('[electron] Opened renderer DevTools (set OPENFORGE_ELECTRON_DEVTOOLS=0 to disable)')
  }
  return window
}

function registerSkeletonIpc(): void {
  ipcMain.handle('openforge:invoke', async (_event, request: unknown) => handleElectronInvoke(
    request as { command?: unknown; payload?: unknown },
    {
      sidecarConfig: sidecar?.config ?? null,
      fetch: (url, init) => fetch(url, init),
      openExternal: (url) => shell.openExternal(url),
    },
  ))
}

async function bootSidecar(): Promise<void> {
  if (!process.env.OPENFORGE_SIDECAR_PATH) {
    if (!process.env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR) {
      console.warn('[electron] OPENFORGE_SIDECAR_PATH is not set; skipping sidecar launch for skeleton dev mode')
    }
    return
  }

  const config = createSidecarLaunchConfig({
    executablePath: process.env.OPENFORGE_SIDECAR_PATH,
    port: Number(process.env.OPENFORGE_BACKEND_PORT ?? 17642),
    processEnv: process.env,
  })

  console.log(`[electron] Starting Rust sidecar: ${config.command} --host ${config.host} --port ${config.port}`)
  sidecar = await startSidecar(config, {
    spawn: (command, args, options) => asChildProcessLike(spawn(command, [...args], options)),
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    logSidecarOutput: true,
  })
  console.log(`[electron] Rust sidecar is ready at ${config.healthUrl}`)
}

registerSkeletonIpc()

app.whenReady().then(async () => {
  await bootSidecar()

  if (sidecar) {
    appEventForwarder = createAppEventForwarder({
      sidecarConfig: sidecar.config,
      fetch: (url, init) => fetch(url, init),
      windows: () => BrowserWindow.getAllWindows(),
    })
    const eventForwarderRun = appEventForwarder.start()
    try {
      await appEventForwarder.ready()
      console.log('[electron] Rust app event stream connected')
    } catch (error) {
      console.error('[electron] Rust app event stream failed:', error)
    }
    void eventForwarderRun.catch(error => {
      console.error('[electron] Rust app event stream failed:', error)
    })
  }

  await createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  appEventForwarder?.stop()
  void sidecar?.stop()
})
