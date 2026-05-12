import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  ElectronRendererTrustAdapter,
  FilePluginAssetAdapter,
  RendererTrustPolicy,
  SidecarPluginMetadataAdapter,
} from './rendererTrustPolicy'
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
  return mkdtemp(join(tmpdir(), 'openforge-renderer-trust-policy-'))
}

describe('Renderer Trust Policy Module', () => {
  it('exposes the complete renderer trust contract behind one deep Interface', () => {
    const policy = new RendererTrustPolicy()

    expect(policy.pluginProtocolScheme()).toEqual({
      scheme: 'plugin',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    })
    expect(policy.contentSecurityPolicy(sidecarConfig)).toBe("default-src 'self'; script-src 'self' plugin:; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:17642 https://api.github.com https://*.atlassian.net")
    expect(policy.contentSecurityPolicy(sidecarConfig)).not.toContain('file:')
    expect(policy.trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://localhost:1420/tasks' })).toBe('http://localhost:1420/tasks')
    expect(() => policy.trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'https://evil.example' })).toThrow('trusted loopback Vite dev server')
    expect(policy.trustedRendererOrigins('http://localhost:1420/tasks')).toEqual(new Set(['http://localhost:1420']))
    expect(policy.trustedRendererOrigins(null)).toEqual(new Set(['file:']))

    expect(policy.shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins: new Set(['http://localhost:1420']),
      mediaTypes: ['microphone'],
    })).toBe(true)
    expect(policy.shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins: new Set(['http://localhost:1420']),
      mediaTypes: ['video'],
    })).toBe(false)
  })

  it('adapts the policy to Electron protocol, CSP headers, and media permission decisions', () => {
    const policy = new RendererTrustPolicy()
    const protocol = { registerSchemesAsPrivileged: vi.fn() }
    const cspCallback = vi.fn()
    const session = {
      webRequest: {
        onHeadersReceived: vi.fn((listener) => listener({ responseHeaders: { Existing: ['ok'] } }, cspCallback)),
      },
    }
    const adapter = new ElectronRendererTrustAdapter(policy)

    adapter.registerPluginProtocolSchemeAsPrivileged(protocol)
    adapter.applyRendererCsp(session, sidecarConfig)

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([policy.pluginProtocolScheme()])
    expect(cspCallback).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: ['ok'],
        'Content-Security-Policy': [policy.contentSecurityPolicy(sidecarConfig)],
      },
    })
    expect(adapter.shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'file:///Applications/Open%20Forge/index.html',
      trustedOrigins: new Set(['file:']),
      mediaTypes: ['audio'],
    })).toBe(true)
  })

  it('resolves plugin metadata through the authenticated sidecar Adapter and reads assets through the canonical file Adapter', async () => {
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
    const metadataAdapter = new SidecarPluginMetadataAdapter(sidecarConfig, fetch)
    const fileAdapter = new FilePluginAssetAdapter({ readFile, realpath })

    await expect(metadataAdapter.resolvePluginAssetRoot('com.example.plugin')).resolves.toEqual({
      pluginId: 'com.example.plugin',
      assetRoot: installRoot,
      isBuiltin: false,
    })
    const asset = await fileAdapter.readCanonicalAsset(installRoot, 'assets/index.js')

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'resolve_plugin_asset_root', payload: { pluginId: 'com.example.plugin' } }),
    })
    expect(asset).toMatchObject({ filePath: await realpath(join(installRoot, 'assets', 'index.js')) })
    if (typeof asset === 'object') expect(asset.content.toString()).toBe('export const ok = true;')
  })

  it('keeps plugin asset outcomes explicit for missing files and canonical traversal escapes', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    const outsideRoot = join(workspaceRoot, 'outside')
    await mkdir(installRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(outsideRoot, 'secret.js'), 'export const secret = true;')
    await symlink(join(outsideRoot, 'secret.js'), join(installRoot, 'linked.js'))

    const fileAdapter = new FilePluginAssetAdapter({ readFile, realpath })

    await expect(fileAdapter.readCanonicalAsset(installRoot, '../secret.js')).resolves.toBe('forbidden')
    await expect(fileAdapter.readCanonicalAsset(installRoot, 'missing.js', 'not-found')).resolves.toBe('not-found')
    await expect(fileAdapter.readCanonicalAsset(installRoot, 'linked.js')).resolves.toBe('forbidden')
  })
})
