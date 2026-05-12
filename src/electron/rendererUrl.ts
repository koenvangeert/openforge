import { DEFAULT_RENDERER_TRUST_POLICY } from './rendererTrustPolicy.js'

export function trustedRendererUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return DEFAULT_RENDERER_TRUST_POLICY.trustedRendererUrlFromEnv(env)
}
