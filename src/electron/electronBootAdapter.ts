import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, protocol, session, shell } from 'electron'
import { handleElectronInvoke } from './backendBridge.js'
import { createMainWindowOptions } from './windowConfig.js'
import { createPreloadPath } from './preloadPath.js'
import { loadAndRevealMainWindow } from './windowStartup.js'
import { shouldGrantMediaPermission, trustedRendererOrigins } from './mediaPermission.js'
import { createAppEventForwarder } from './eventForwarder.js'
import { trustedRendererUrlFromEnv } from './rendererUrl.js'
import { resolveElectronSidecarPath } from './sidecarPath.js'
import { configureElectronUserDataPath } from './runtimePaths.js'
import {
  applyElectronRendererCsp,
  createElectronRendererCsp,
  registerPluginProtocolHandler,
  registerPluginProtocolSchemeAsPrivileged,
  resolveHostRuntimeRoot,
} from './pluginProtocol.js'
import { asChildProcessLike, createSidecarLaunchConfig, startSidecarReadiness } from './sidecar.js'
import type { BootBackendInvokeContext, BootLifecycleAdapter } from './bootLifecycle.js'
import type { SidecarEventEnvelopeLike, SidecarLaunchConfig, SidecarReadinessHandle } from './sidecar.js'

export interface ElectronBootAdapterOptions {
  currentDir: string
  workspaceRoot: string
  env: NodeJS.ProcessEnv
}

/** Real Electron Adapter for the Boot Lifecycle Module seam. */
export function createElectronBootAdapter(options: ElectronBootAdapterOptions): BootLifecycleAdapter {
  async function createMainWindow(): Promise<BrowserWindow> {
    const preloadPath = createPreloadPath(options.currentDir)
    const window = new BrowserWindow(createMainWindowOptions(preloadPath))

    const rendererUrl = trustedRendererUrlFromEnv(options.env)
    const trustedOrigins = trustedRendererOrigins(rendererUrl)
    const mainWebContentsId = window.webContents.id
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(shouldGrantMediaPermission({
        permission,
        isMainWindowWebContents: webContents.id === mainWebContentsId,
        requestingUrl: details.requestingUrl,
        trustedOrigins,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      }))
    })

    console.log(`[electron] Loading renderer from ${rendererUrl ?? 'packaged dist/index.html'}`)
    await loadAndRevealMainWindow(window, rendererUrl
      ? { rendererUrl }
      : { filePath: join(options.currentDir, '..', 'dist', 'index.html') })
    return window
  }

  return {
    registerPluginProtocolSchemeAsPrivileged(): void {
      registerPluginProtocolSchemeAsPrivileged(protocol)
    },

    registerBackendInvokeHandler(context: BootBackendInvokeContext): void {
      ipcMain.handle('openforge:invoke', async (_event, request: unknown) => handleElectronInvoke(
        request as { command?: unknown; payload?: unknown },
        {
          sidecarConfig: context.getSidecarConfig(),
          fetch: (url, init) => fetch(url, init),
          openExternal: (url) => shell.openExternal(url),
        },
      ))
    },

    configureUserDataPath(): string | null {
      return configureElectronUserDataPath(app, options.env)
    },

    onWindowAllClosed(handler: () => void): void {
      app.on('window-all-closed', handler)
    },

    onBeforeQuit(handler: () => void): void {
      app.on('before-quit', handler)
    },

    waitForAppReady(): Promise<void> {
      return app.whenReady()
    },

    resolveSidecarPath(): string | null {
      return resolveElectronSidecarPath(options.env, options.currentDir)
    },

    createSidecarLaunchConfig(sidecarPath: string): SidecarLaunchConfig {
      return createSidecarLaunchConfig({
        executablePath: sidecarPath,
        port: Number(options.env.OPENFORGE_BACKEND_PORT ?? 17642),
        processEnv: options.env,
      })
    },

    async startSidecar(config: SidecarLaunchConfig): Promise<SidecarReadinessHandle> {
      console.log(`[electron] Starting Rust sidecar: ${config.command} --host ${config.host} --port ${config.port}`)
      const sidecar = await startSidecarReadiness(config, {
        spawn: (command, args, spawnOptions) => asChildProcessLike(spawn(command, [...args], spawnOptions)),
        fetch: (url, init) => fetch(url, init),
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        logSidecarOutput: true,
        createEventStream: sidecarConfig => {
          let eventListener: ((envelope: SidecarEventEnvelopeLike) => void) | null = null
          const forwarder = createAppEventForwarder({
            sidecarConfig,
            fetch: (url, init) => fetch(url, init),
            windows: () => BrowserWindow.getAllWindows(),
            onEvent: envelope => eventListener?.(envelope),
          })
          return {
            ...forwarder,
            onEvent(listener: (envelope: SidecarEventEnvelopeLike) => void): void {
              eventListener = listener
            },
          }
        },
      })
      const readiness = await sidecar.ready()
      console.log(`[electron] Rust sidecar is ready at ${readiness.identity.readinessUrl}`)
      return sidecar
    },

    registerPluginProtocolHandler(sidecarConfig: SidecarLaunchConfig | null): void {
      registerPluginProtocolHandler(protocol, {
        workspaceRoot: options.workspaceRoot,
        hostRuntimeRoot: resolveHostRuntimeRoot(options.currentDir),
        sidecarConfig,
        fetch: (url, init) => fetch(url, init),
      })
    },

    applyRendererCsp(sidecarConfig: SidecarLaunchConfig | null): void {
      applyElectronRendererCsp(session.defaultSession, createElectronRendererCsp(sidecarConfig))
    },

    createMainWindow,

    quit(): void {
      app.quit()
    },
  }
}
