const TRUSTED_DEV_RENDERER_HOSTS = new Set(['localhost', '127.0.0.1'])
const TRUSTED_DEV_RENDERER_PORT = '1420'

export function trustedRendererUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const rendererUrl = env.ELECTRON_RENDERER_URL
  if (!rendererUrl) return null

  let parsed: URL
  try {
    parsed = new URL(rendererUrl)
  } catch {
    throw new Error('ELECTRON_RENDERER_URL must be a valid URL')
  }

  if (parsed.protocol !== 'http:' || !TRUSTED_DEV_RENDERER_HOSTS.has(parsed.hostname) || parsed.port !== TRUSTED_DEV_RENDERER_PORT) {
    throw new Error('ELECTRON_RENDERER_URL must point to the trusted Vite dev server at http://127.0.0.1:1420')
  }

  return parsed.toString()
}
