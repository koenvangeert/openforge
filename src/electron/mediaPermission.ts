export type MediaPermissionSubtype = 'audio' | 'video' | 'microphone' | 'camera' | 'unknown'

export interface MediaPermissionRequest {
  permission: string
  isMainWindowWebContents: boolean
  requestingUrl?: string
  trustedOrigins: ReadonlySet<string>
  mediaType?: MediaPermissionSubtype | string
  mediaTypes?: readonly (MediaPermissionSubtype | string)[]
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

export function shouldGrantMediaPermission(request: MediaPermissionRequest): boolean {
  if (request.permission !== 'media') return false
  if (!request.isMainWindowWebContents) return false
  if (!requestsOnlyAudio(request)) return false

  const origin = requestOrigin(request.requestingUrl)
  return origin !== null && request.trustedOrigins.has(origin)
}

export function trustedRendererOrigins(rendererUrl: string | null): Set<string> {
  if (!rendererUrl) return new Set(['file:'])

  try {
    const url = new URL(rendererUrl)
    return new Set([url.protocol === 'file:' ? 'file:' : url.origin])
  } catch {
    return new Set()
  }
}
