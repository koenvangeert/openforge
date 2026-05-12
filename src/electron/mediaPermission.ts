import { DEFAULT_RENDERER_TRUST_POLICY } from './rendererTrustPolicy.js'
import type { MediaPermissionRequest } from './rendererTrustPolicy.js'

export type { MediaPermissionRequest, MediaPermissionSubtype } from './rendererTrustPolicy.js'

export function shouldGrantMediaPermission(request: MediaPermissionRequest): boolean {
  return DEFAULT_RENDERER_TRUST_POLICY.shouldGrantMediaPermission(request)
}

export function trustedRendererOrigins(rendererUrl: string | null): Set<string> {
  return DEFAULT_RENDERER_TRUST_POLICY.trustedRendererOrigins(rendererUrl)
}
