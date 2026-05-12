import { join } from 'node:path'
import {
  DEFAULT_RENDERER_TRUST_POLICY,
  ElectronRendererTrustAdapter,
  FilePluginAssetAdapter,
  PLUGIN_PROTOCOL_SCHEME,
  SidecarPluginMetadataAdapter,
  isForbiddenPluginAssetPath,
  stripQueryAndHash,
} from './rendererTrustPolicy.js'
import type {
  ElectronProtocolLike,
  ElectronSessionLike,
  PluginProtocolFetch,
  PluginProtocolReadFile,
  PluginProtocolRealpath,
} from './rendererTrustPolicy.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export { PLUGIN_PROTOCOL_SCHEME } from './rendererTrustPolicy.js'
export type { ElectronProtocolLike, ElectronSessionLike } from './rendererTrustPolicy.js'

export function createElectronRendererCsp(sidecarConfig: Pick<SidecarLaunchConfig, 'host' | 'port'> | null = null): string {
  return DEFAULT_RENDERER_TRUST_POLICY.contentSecurityPolicy(sidecarConfig)
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


export interface PluginProtocolDeps {
  workspaceRoot: string
  hostRuntimeRoot?: string
  sidecarConfig: SidecarLaunchConfig | null
  fetch: PluginProtocolFetch
  readFile?: PluginProtocolReadFile
  realpath?: PluginProtocolRealpath
}

export interface ElectronProtocolHandlerLike {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
}

type ParsedPluginUrl = {
  pluginId: string
  relPath: string
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

function mimeTypeForPath(path: string): string {
  const cleanPath = stripQueryAndHash(path).toLowerCase()
  if (cleanPath.endsWith('.js') || cleanPath.endsWith('.mjs')) return 'application/javascript'
  if (cleanPath.endsWith('.json')) return 'application/json'
  if (cleanPath.endsWith('.css')) return 'text/css'
  if (cleanPath.endsWith('.html')) return 'text/html'
  return 'application/octet-stream'
}

export function resolveHostRuntimeRoot(electronMainDir: string): string {
  return join(electronMainDir, 'plugin-host')
}

function configuredHostRuntimeRoot(deps: PluginProtocolDeps): string {
  return deps.hostRuntimeRoot ?? join(deps.workspaceRoot, 'dist-electron', 'plugin-host')
}

async function packagedHostRuntimeAssetResponse(relPath: string, deps: PluginProtocolDeps): Promise<Response> {
  const asset = await new FilePluginAssetAdapter({
    readFile: deps.readFile,
    realpath: deps.realpath,
  }).readCanonicalAsset(configuredHostRuntimeRoot(deps), relPath, 'not-found')

  return asset === 'forbidden'
    ? forbiddenResponse()
    : asset === 'not-found'
      ? notFoundResponse()
      : okResponse(mimeTypeForPath(asset.filePath), asset.content)
}

async function hostRuntimeResponse(relPath: string, deps: PluginProtocolDeps): Promise<Response> {
  if (isForbiddenPluginAssetPath(relPath)) return forbiddenResponse()
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

async function pluginAssetResponse(parsed: ParsedPluginUrl, deps: PluginProtocolDeps): Promise<Response> {
  if (!validatePluginId(parsed.pluginId) || isForbiddenPluginAssetPath(parsed.relPath)) {
    return forbiddenResponse()
  }

  const assetRoot = await new SidecarPluginMetadataAdapter(deps.sidecarConfig, deps.fetch)
    .resolvePluginAssetRoot(parsed.pluginId)
  if (!assetRoot || assetRoot.pluginId !== parsed.pluginId) return response(403, `Unknown plugin: ${parsed.pluginId}`)

  const asset = await new FilePluginAssetAdapter({
    readFile: deps.readFile,
    realpath: deps.realpath,
  }).readCanonicalAsset(assetRoot.assetRoot, parsed.relPath)

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
  new ElectronRendererTrustAdapter().registerPluginProtocolSchemeAsPrivileged(protocol)
}

export function registerPluginProtocolHandler(protocol: ElectronProtocolHandlerLike, deps: PluginProtocolDeps): void {
  protocol.handle(PLUGIN_PROTOCOL_SCHEME, (request) => handlePluginProtocolRequest(request.url, deps))
}

export function applyElectronRendererCsp(session: ElectronSessionLike, csp: string = ELECTRON_RENDERER_CSP): void {
  new ElectronRendererTrustAdapter().applyRendererCsp(session, null, csp)
}
