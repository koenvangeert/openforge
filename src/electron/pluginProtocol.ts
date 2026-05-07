import { readFile as nodeReadFile, realpath as nodeRealpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep, win32 } from 'node:path'
import type { SidecarLaunchConfig } from './sidecar.js'

export const PLUGIN_PROTOCOL_SCHEME = 'plugin'

export function createElectronRendererCsp(sidecarConfig: Pick<SidecarLaunchConfig, 'host' | 'port'> | null = null): string {
  const sidecarOrigin = `http://${sidecarConfig?.host ?? '127.0.0.1'}:${sidecarConfig?.port ?? 17642}`
  return `default-src 'self'; script-src 'self' plugin:; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' ${sidecarOrigin} https://api.github.com https://*.atlassian.net`
}

export const ELECTRON_RENDERER_CSP = createElectronRendererCsp()

const HOST_RUNTIME_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Open Forge Plugin Runtime</title>
  </head>
  <body>
    <script type="module" src="plugin://host-runtime/runtime.js"></script>
  </body>
</html>
`
const HOST_RUNTIME_RUNTIME_JS = 'globalThis.__OPENFORGE_PLUGIN_RUNTIME__ = true; export const runtimeReady = true;'

type PluginProtocolFetchResponse = {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

type PluginProtocolFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<PluginProtocolFetchResponse>

type PluginProtocolReadFile = (path: string) => Promise<Uint8Array | string>
type PluginProtocolRealpath = (path: string) => Promise<string>

export interface PluginProtocolDeps {
  workspaceRoot: string
  hostRuntimeRoot?: string
  sidecarConfig: SidecarLaunchConfig | null
  fetch: PluginProtocolFetch
  readFile?: PluginProtocolReadFile
  realpath?: PluginProtocolRealpath
}

export interface ElectronProtocolLike {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string
    privileges: {
      standard: boolean
      secure: boolean
      supportFetchAPI: boolean
      corsEnabled: boolean
    }
  }>): void
}

export interface ElectronProtocolHandlerLike {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
}

export interface ElectronSessionLike {
  webRequest: {
    onHeadersReceived(listener: (
      details: { responseHeaders?: Record<string, string[] | string> },
      callback: (response: { responseHeaders: Record<string, string[] | string> }) => void,
    ) => void): void
  }
}

type ParsedPluginUrl = {
  pluginId: string
  relPath: string
}

type PluginAssetRoot = {
  pluginId: string
  assetRoot: string
  isBuiltin: boolean
}

function responseBody(body: Uint8Array | string): BodyInit {
  if (typeof body === 'string') return body
  const copy = new Uint8Array(body.byteLength)
  copy.set(body)
  return copy.buffer
}

function response(status: number, body: Uint8Array | string, contentType?: string): Response {
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*' })
  if (contentType) headers.set('Content-Type', contentType)
  return new Response(responseBody(body), { status, headers })
}

function okResponse(contentType: string, body: Uint8Array | string): Response {
  return response(200, body, contentType)
}

function forbiddenResponse(): Response {
  return response(403, 'Forbidden')
}

function notFoundResponse(): Response {
  return response(404, 'File not found')
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const indexes = [queryIndex, hashIndex].filter(index => index >= 0)
  return indexes.length === 0 ? value : value.slice(0, Math.min(...indexes))
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function parsePluginUrl(requestUrl: string): ParsedPluginUrl | null {
  const rawPath = requestUrl.startsWith('plugin://')
    ? stripQueryAndHash(requestUrl.slice('plugin://'.length))
    : null
  if (rawPath === null) return null

  const separatorIndex = rawPath.indexOf('/')
  const rawPluginId = separatorIndex >= 0 ? rawPath.slice(0, separatorIndex) : rawPath
  const rawRelPath = separatorIndex >= 0 ? rawPath.slice(separatorIndex + 1) : ''
  const pluginId = safeDecode(rawPluginId)
  const relPath = safeDecode(rawRelPath)
  if (pluginId === null || relPath === null) return null

  return { pluginId, relPath }
}

function validatePluginId(pluginId: string): boolean {
  return pluginId.length > 0
    && !pluginId.includes('/')
    && !pluginId.includes('\\')
    && pluginId !== '.'
    && pluginId !== '..'
}

function isForbiddenAssetPath(relPath: string): boolean {
  return relPath.includes('..')
    || isAbsolute(relPath)
    || win32.isAbsolute(relPath)
}

function mimeTypeForPath(path: string): string {
  const cleanPath = stripQueryAndHash(path).toLowerCase()
  if (cleanPath.endsWith('.js') || cleanPath.endsWith('.mjs')) return 'application/javascript'
  if (cleanPath.endsWith('.json')) return 'application/json'
  if (cleanPath.endsWith('.css')) return 'text/css'
  if (cleanPath.endsWith('.html')) return 'text/html'
  return 'application/octet-stream'
}

function isInsideDirectory(candidate: string, base: string): boolean {
  const rel = relative(base, candidate)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !isAbsolute(rel))
}

async function readCanonicalAsset(
  installBaseDir: string,
  relPath: string,
  deps: Required<Pick<PluginProtocolDeps, 'readFile' | 'realpath'>>,
  missingResult: 'forbidden' | 'not-found' = 'forbidden',
): Promise<{ content: Uint8Array | string; filePath: string } | 'forbidden' | 'not-found'> {
  if (isForbiddenAssetPath(relPath)) return 'forbidden'

  let canonicalBase: string
  let canonicalCandidate: string
  try {
    canonicalBase = await deps.realpath(installBaseDir)
    canonicalCandidate = await deps.realpath(join(installBaseDir, relPath))
  } catch {
    return missingResult
  }

  if (!isInsideDirectory(canonicalCandidate, canonicalBase)) return 'forbidden'

  try {
    return {
      content: await deps.readFile(canonicalCandidate),
      filePath: canonicalCandidate,
    }
  } catch {
    return 'not-found'
  }
}

export function resolveHostRuntimeRoot(electronMainDir: string): string {
  return join(electronMainDir, 'plugin-host')
}

function configuredHostRuntimeRoot(deps: PluginProtocolDeps): string {
  return deps.hostRuntimeRoot ?? join(deps.workspaceRoot, 'dist-electron', 'plugin-host')
}

async function packagedHostRuntimeAssetResponse(relPath: string, deps: PluginProtocolDeps): Promise<Response> {
  const asset = await readCanonicalAsset(
    configuredHostRuntimeRoot(deps),
    relPath,
    { readFile: deps.readFile ?? nodeReadFile, realpath: deps.realpath ?? nodeRealpath },
    'not-found',
  )

  return asset === 'forbidden'
    ? forbiddenResponse()
    : asset === 'not-found'
      ? notFoundResponse()
      : okResponse(mimeTypeForPath(asset.filePath), asset.content)
}

async function hostRuntimeResponse(relPath: string, deps: PluginProtocolDeps): Promise<Response> {
  if (isForbiddenAssetPath(relPath)) return forbiddenResponse()

  switch (relPath) {
    case 'index.html':
      return okResponse('text/html; charset=utf-8', HOST_RUNTIME_INDEX_HTML)
    case 'runtime.js':
      return okResponse('application/javascript', HOST_RUNTIME_RUNTIME_JS)
    case 'plugin-sdk/index.js':
      return packagedHostRuntimeAssetResponse(relPath, deps)
    default:
      return relPath.startsWith('svelte/')
        ? packagedHostRuntimeAssetResponse(relPath, deps)
        : notFoundResponse()
  }
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

async function fetchPluginAssetRoot(pluginId: string, deps: PluginProtocolDeps): Promise<PluginAssetRoot | null> {
  if (!deps.sidecarConfig) return null

  const sidecarUrl = `http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/invoke`
  const response = await deps.fetch(sidecarUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.sidecarConfig.token}`,
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

async function pluginAssetResponse(parsed: ParsedPluginUrl, deps: PluginProtocolDeps): Promise<Response> {
  if (!validatePluginId(parsed.pluginId) || isForbiddenAssetPath(parsed.relPath)) {
    return forbiddenResponse()
  }

  const assetRoot = await fetchPluginAssetRoot(parsed.pluginId, deps)
  if (!assetRoot || assetRoot.pluginId !== parsed.pluginId) return response(403, `Unknown plugin: ${parsed.pluginId}`)

  const asset = await readCanonicalAsset(
    assetRoot.assetRoot,
    parsed.relPath,
    { readFile: deps.readFile ?? nodeReadFile, realpath: deps.realpath ?? nodeRealpath },
  )

  return asset === 'forbidden'
    ? forbiddenResponse()
    : asset === 'not-found'
      ? notFoundResponse()
      : okResponse(mimeTypeForPath(asset.filePath), asset.content)
}

export async function handlePluginProtocolRequest(requestUrl: string, deps: PluginProtocolDeps): Promise<Response> {
  const parsed = parsePluginUrl(requestUrl)
  if (!parsed) return forbiddenResponse()

  if (parsed.pluginId === 'host-runtime') {
    return hostRuntimeResponse(parsed.relPath, deps)
  }

  return pluginAssetResponse(parsed, deps)
}

export function registerPluginProtocolSchemeAsPrivileged(protocol: ElectronProtocolLike): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

export function registerPluginProtocolHandler(protocol: ElectronProtocolHandlerLike, deps: PluginProtocolDeps): void {
  protocol.handle(PLUGIN_PROTOCOL_SCHEME, (request) => handlePluginProtocolRequest(request.url, deps))
}

export function applyElectronRendererCsp(session: ElectronSessionLike, csp: string = ELECTRON_RENDERER_CSP): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        'Content-Security-Policy': [csp],
      },
    })
  })
}
