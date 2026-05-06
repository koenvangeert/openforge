const TRUSTED_DEV_RENDERER_HOSTS = new Set(['localhost', '127.0.0.1'])

export function trustedRendererUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
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
