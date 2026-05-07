import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  ELECTRON_RENDERER_CSP,
  applyElectronRendererCsp,
  createElectronRendererCsp,
  handlePluginProtocolRequest,
  registerPluginProtocolHandler,
  registerPluginProtocolSchemeAsPrivileged,
} from './pluginProtocol'
import type { SidecarLaunchConfig } from './sidecar'

const sidecarConfig: SidecarLaunchConfig = {
  command: 'openforge-sidecar',
  args: [],
  env: {},
  host: '127.0.0.1',
  port: 17642,
  token: 'secret-token',
  baseUrl: 'http://127.0.0.1:17642',
  healthUrl: 'http://127.0.0.1:17642/app/health',
  readinessUrl: 'http://127.0.0.1:17642/app/readiness',
  eventUrl: 'http://127.0.0.1:17642/app/events',
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'openforge-electron-plugin-protocol-'))
}

describe('Electron plugin:// protocol security contract', () => {
  it('registers plugin:// as a privileged secure standard scheme before app ready', () => {
    const protocol = { registerSchemesAsPrivileged: vi.fn() }

    registerPluginProtocolSchemeAsPrivileged(protocol)

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'plugin',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ])
  })

  it('serves host-runtime assets without requiring a Rust sidecar', async () => {
    const workspaceRoot = await tempWorkspace()
    const response = await handlePluginProtocolRequest('plugin://host-runtime/runtime.js', {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.text()).toContain('runtimeReady')
  })

  it('rejects host-runtime traversal before touching the filesystem', async () => {
    const workspaceRoot = await tempWorkspace()
    const response = await handlePluginProtocolRequest('plugin://host-runtime/%2e%2e/runtime.js', {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('serves host-runtime plugin SDK and Svelte assets from Electron resources without source-tree fallbacks', async () => {
    const workspaceRoot = await tempWorkspace()
    const hostRuntimeRoot = join(await tempWorkspace(), 'plugin-host')
    await mkdir(join(hostRuntimeRoot, 'plugin-sdk'), { recursive: true })
    await mkdir(join(hostRuntimeRoot, 'svelte'), { recursive: true })
    await writeFile(join(hostRuntimeRoot, 'plugin-sdk', 'index.js'), 'export const pluginSdkFromResources = true;')
    await writeFile(join(hostRuntimeRoot, 'svelte', 'index.js'), 'export const svelteFromResources = true;')

    const pluginSdkResponse = await handlePluginProtocolRequest('plugin://host-runtime/plugin-sdk/index.js', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })
    const svelteResponse = await handlePluginProtocolRequest('plugin://host-runtime/svelte/index.js', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })

    expect(pluginSdkResponse.status).toBe(200)
    expect(await pluginSdkResponse.text()).toBe('export const pluginSdkFromResources = true;')
    expect(svelteResponse.status).toBe(200)
    expect(await svelteResponse.text()).toBe('export const svelteFromResources = true;')
  })

  it('loads an external plugin asset via authenticated Rust asset-root resolution and preserves MIME/CORS headers', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    await mkdir(join(installRoot, 'assets'), { recursive: true })
    await writeFile(join(installRoot, 'assets', 'index.js'), 'export const ok = true;')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/assets/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'resolve_plugin_asset_root', payload: { pluginId: 'com.example.plugin' } }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.text()).toBe('export const ok = true;')
  })

  it('uses Rust-resolved asset roots for builtin plugins instead of Electron builtin path mapping', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(await tempWorkspace(), 'rust-resolved-builtin')
    await mkdir(join(installRoot, 'dist'), { recursive: true })
    await writeFile(join(installRoot, 'dist', 'index.js'), 'export const builtin = true;')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.openforge.file-viewer',
        asset_root: installRoot,
        is_builtin: true,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.openforge.file-viewer/dist/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('export const builtin = true;')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects invalid plugin ids and traversal paths with the same forbidden response shape as Tauri', async () => {
    const workspaceRoot = await tempWorkspace()
    const fetch = vi.fn()

    for (const url of [
      'plugin:///index.js',
      'plugin://%2e%2e/index.js',
      'plugin://com.example.plugin/%2e%2e/index.js',
      'plugin://com.example.plugin//etc/passwd',
    ]) {
      const response = await handlePluginProtocolRequest(url, {
        workspaceRoot,
        sidecarConfig,
        fetch,
      })
      expect(response.status, url).toBe(403)
      expect(await response.text(), url).toBe('Forbidden')
    }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects sidecar asset-root responses that do not match the requested plugin id', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(await tempWorkspace(), 'other-plugin')
    await mkdir(installRoot, { recursive: true })
    await writeFile(join(installRoot, 'index.js'), 'export const wrong = true;')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.other-plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Unknown plugin: com.example.plugin')
  })

  it('rejects canonicalized plugin asset paths that escape the plugin install root', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    const outsideRoot = join(workspaceRoot, 'outside')
    await mkdir(installRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(outsideRoot, 'secret.js'), 'export const secret = true;')
    await symlink(join(outsideRoot, 'secret.js'), join(installRoot, 'linked.js'))

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/linked.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('keeps renderer CSP compatible with plugin:// import maps and sidecar IPC without unsafe filesystem access', () => {
    expect(ELECTRON_RENDERER_CSP).toContain("default-src 'self'")
    expect(ELECTRON_RENDERER_CSP).toContain("script-src 'self' plugin:")
    expect(ELECTRON_RENDERER_CSP).toContain("connect-src 'self' http://127.0.0.1:17642 https://api.github.com https://*.atlassian.net")
    expect(createElectronRendererCsp({ host: '127.0.0.1', port: 18000 })).toContain('http://127.0.0.1:18000')
    expect(ELECTRON_RENDERER_CSP).not.toContain('file:')
  })

  it('applies renderer CSP through Electron session headers', () => {
    const callback = vi.fn()
    const session = {
      webRequest: {
        onHeadersReceived: vi.fn((listener) => listener({ responseHeaders: { Existing: ['ok'] } }, callback)),
      },
    }

    applyElectronRendererCsp(session, 'default-src test:')

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: ['ok'],
        'Content-Security-Policy': ['default-src test:'],
      },
    })
  })

  it('registers a plugin protocol handler without exposing sidecar token or filesystem through preload', async () => {
    const protocol = { handle: vi.fn() }
    const workspaceRoot = await tempWorkspace()

    registerPluginProtocolHandler(protocol, {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(protocol.handle).toHaveBeenCalledOnce()
    expect(protocol.handle.mock.calls[0][0]).toBe('plugin')
    const handler = protocol.handle.mock.calls[0][1] as (request: Request) => Promise<Response>
    const response = await handler(new Request('plugin://host-runtime/runtime.js'))
    expect(response.status).toBe(200)
  })
})
