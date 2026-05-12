import { readFile as nodeReadFile, realpath as nodeRealpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep, win32 } from 'node:path'
import type { SidecarLaunchConfig } from './sidecar.js'

export const PLUGIN_PROTOCOL_SCHEME = 'plugin'

export type MediaPermissionSubtype = 'audio' | 'video' | 'microphone' | 'camera' | 'unknown'

export interface MediaPermissionRequest {
  permission: string
  isMainWindowWebContents: boolean
  requestingUrl?: string
  trustedOrigins: ReadonlySet<string>
  mediaType?: MediaPermissionSubtype | string
  mediaTypes?: readonly (MediaPermissionSubtype | string)[]
}

export interface PluginAssetRoot {
  pluginId: string
  assetRoot: string
  isBuiltin: boolean
}

export type PluginProtocolFetchResponse = {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export type PluginProtocolFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<PluginProtocolFetchResponse>

export type PluginProtocolReadFile = (path: string) => Promise<Uint8Array | string>
export type PluginProtocolRealpath = (path: string) => Promise<string>

export interface ElectronProtocolLike {
  registerSchemesAsPrivileged(schemes: Array<RendererTrustPolicyScheme>): void
}

export interface ElectronSessionLike {
  webRequest: {
    onHeadersReceived(listener: (
      details: { responseHeaders?: Record<string, string[] | string> },
      callback: (response: { responseHeaders: Record<string, string[] | string> }) => void,
    ) => void): void
  }
}

export interface RendererTrustPolicyScheme {
  scheme: string
  privileges: {
    standard: boolean
    secure: boolean
    supportFetchAPI: boolean
    corsEnabled: boolean
  }
}

export type CanonicalPluginAsset = { content: Uint8Array | string; filePath: string }
export type PluginAssetReadResult = CanonicalPluginAsset | 'forbidden' | 'not-found'

const DEFAULT_SIDECAR_HOST = '127.0.0.1'
const DEFAULT_SIDECAR_PORT = 17642
const TRUSTED_CONNECT_SRC = ['https://api.github.com', 'https://*.atlassian.net']
const TRUSTED_DEV_RENDERER_HOSTS = new Set(['localhost', '127.0.0.1'])

function sidecarOrigin(sidecarConfig: Pick<SidecarLaunchConfig, 'host' | 'port'> | null): string {
  return `http://${sidecarConfig?.host ?? DEFAULT_SIDECAR_HOST}:${sidecarConfig?.port ?? DEFAULT_SIDECAR_PORT}`
}

function requestOrigin(requestingUrl: string | undefined): string | null {
  if (!requestingUrl) return null

  try {
    const url = new URL(requestingUrl)
    return url.protocol === 'file:' ? 'file:' : url.origin
  } catch {
    return null
  }
}

function requestsOnlyAudio(request: MediaPermissionRequest): boolean {
  const mediaTypes = request.mediaTypes ?? (request.mediaType ? [request.mediaType] : [])
  if (mediaTypes.length === 0) return false

  return mediaTypes.every(type => type === 'audio' || type === 'microphone')
}

function normalizePluginAssetRoot(value: unknown): PluginAssetRoot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const pluginId = typeof record.pluginId === 'string'
    ? record.pluginId
    : typeof record.plugin_id === 'string'
      ? record.plugin_id
      : null
  const assetRoot = typeof record.assetRoot === 'string'
    ? record.assetRoot
    : typeof record.asset_root === 'string'
      ? record.asset_root
      : null
  const isBuiltin = typeof record.isBuiltin === 'boolean'
    ? record.isBuiltin
    : typeof record.is_builtin === 'boolean'
      ? record.is_builtin
      : null

  return pluginId && assetRoot && isBuiltin !== null
    ? { pluginId, assetRoot, isBuiltin }
    : null
}

export function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const indexes = [queryIndex, hashIndex].filter(index => index >= 0)
  return indexes.length === 0 ? value : value.slice(0, Math.min(...indexes))
}

export function isForbiddenPluginAssetPath(relPath: string): boolean {
  return relPath.includes('..')
    || isAbsolute(relPath)
    || win32.isAbsolute(relPath)
}

function isInsideDirectory(candidate: string, base: string): boolean {
  const rel = relative(base, candidate)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Renderer Trust Policy Module.
 *
 * The Interface is intentionally small: one Seam for protocol privilege, CSP,
 * trusted renderer origins, and audio-only media permission. The Implementation
 * gives Electron boot Leverage and security Locality instead of scattering the
 * trust rules across callers.
 */
export class RendererTrustPolicy {
  pluginProtocolScheme(): RendererTrustPolicyScheme {
    return {
      scheme: PLUGIN_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    }
  }

  contentSecurityPolicy(sidecarConfig: Pick<SidecarLaunchConfig, 'host' | 'port'> | null = null): string {
    return [
      "default-src 'self'",
      "script-src 'self' plugin:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self' data:",
      `connect-src 'self' ${[sidecarOrigin(sidecarConfig), ...TRUSTED_CONNECT_SRC].join(' ')}`,
    ].join('; ')
  }

  trustedRendererUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
    const rendererUrl = env.ELECTRON_RENDERER_URL
    if (!rendererUrl) return null

    let parsed: URL
    try {
      parsed = new URL(rendererUrl)
    } catch {
      throw new Error('ELECTRON_RENDERER_URL must be a valid URL')
    }

    if (parsed.protocol !== 'http:' || !TRUSTED_DEV_RENDERER_HOSTS.has(parsed.hostname)) {
      throw new Error('ELECTRON_RENDERER_URL must point to a trusted loopback Vite dev server')
    }

    if (!parsed.port) {
      throw new Error('ELECTRON_RENDERER_URL must include an explicit port')
    }

    return parsed.toString()
  }

  trustedRendererOrigins(rendererUrl: string | null): Set<string> {
    if (!rendererUrl) return new Set(['file:'])

    try {
      const url = new URL(rendererUrl)
      return new Set([url.protocol === 'file:' ? 'file:' : url.origin])
    } catch {
      return new Set()
    }
  }

  shouldGrantMediaPermission(request: MediaPermissionRequest): boolean {
    if (request.permission !== 'media') return false
    if (!request.isMainWindowWebContents) return false
    if (!requestsOnlyAudio(request)) return false

    const origin = requestOrigin(request.requestingUrl)
    return origin !== null && request.trustedOrigins.has(origin)
  }
}

export const DEFAULT_RENDERER_TRUST_POLICY = new RendererTrustPolicy()

/** Adapter from the Renderer Trust Policy Module to Electron shell primitives. */
export class ElectronRendererTrustAdapter {
  constructor(private readonly policy: RendererTrustPolicy = DEFAULT_RENDERER_TRUST_POLICY) {}

  registerPluginProtocolSchemeAsPrivileged(protocol: ElectronProtocolLike): void {
    protocol.registerSchemesAsPrivileged([this.policy.pluginProtocolScheme()])
  }

  applyRendererCsp(
    session: ElectronSessionLike,
    sidecarConfig: Pick<SidecarLaunchConfig, 'host' | 'port'> | null = null,
    csp: string = this.policy.contentSecurityPolicy(sidecarConfig),
  ): void {
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...(details.responseHeaders ?? {}),
          'Content-Security-Policy': [csp],
        },
      })
    })
  }

  trustedRendererUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
    return this.policy.trustedRendererUrlFromEnv(env)
  }

  trustedRendererOrigins(rendererUrl: string | null): Set<string> {
    return this.policy.trustedRendererOrigins(rendererUrl)
  }

  shouldGrantMediaPermission(request: MediaPermissionRequest): boolean {
    return this.policy.shouldGrantMediaPermission(request)
  }
}

/** Adapter that resolves plugin asset metadata through authenticated sidecar IPC. */
export class SidecarPluginMetadataAdapter {
  constructor(
    private readonly sidecarConfig: SidecarLaunchConfig | null,
    private readonly fetch: PluginProtocolFetch,
  ) {}

  async resolvePluginAssetRoot(pluginId: string): Promise<PluginAssetRoot | null> {
    if (!this.sidecarConfig) return null

    const sidecarUrl = `http://${this.sidecarConfig.host}:${this.sidecarConfig.port}/app/invoke`
    const response = await this.fetch(sidecarUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.sidecarConfig.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'resolve_plugin_asset_root', payload: { pluginId } }),
    })

    if (!response.ok) return null

    const body = await response.json()
    const rawAssetRoot = typeof body === 'object' && body !== null && 'value' in body
      ? (body as { value: unknown }).value
      : body
    return normalizePluginAssetRoot(rawAssetRoot)
  }
}

/** Adapter that keeps plugin asset file reads canonicalized behind one testable Seam. */
export class FilePluginAssetAdapter {
  constructor(
    private readonly deps: {
      readFile?: PluginProtocolReadFile
      realpath?: PluginProtocolRealpath
    } = {},
  ) {}

  async readCanonicalAsset(
    installBaseDir: string,
    relPath: string,
    missingResult: 'forbidden' | 'not-found' = 'forbidden',
  ): Promise<PluginAssetReadResult> {
    if (isForbiddenPluginAssetPath(relPath)) return 'forbidden'

    const readFile = this.deps.readFile ?? nodeReadFile
    const realpath = this.deps.realpath ?? nodeRealpath

    let canonicalBase: string
    let canonicalCandidate: string
    try {
      canonicalBase = await realpath(installBaseDir)
      canonicalCandidate = await realpath(join(installBaseDir, relPath))
    } catch {
      return missingResult
    }

    if (!isInsideDirectory(canonicalCandidate, canonicalBase)) return 'forbidden'

    try {
      return {
        content: await readFile(canonicalCandidate),
        filePath: canonicalCandidate,
      }
    } catch {
      return 'not-found'
    }
  }
}
