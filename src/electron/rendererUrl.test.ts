import { describe, expect, it } from 'vitest'
import { trustedRendererUrlFromEnv } from './rendererUrl'

describe('trustedRendererUrlFromEnv', () => {
  it('accepts the trusted Vite dev server URL', () => {
    expect(trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://localhost:1420' })).toBe('http://localhost:1420/')
    expect(trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://127.0.0.1:1420/' })).toBe('http://127.0.0.1:1420/')
  })

  it('rejects untrusted renderer URLs before exposing the preload bridge', () => {
    expect(() => trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'https://example.com' })).toThrow('trusted Vite dev server')
    expect(() => trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://localhost:3000' })).toThrow('trusted Vite dev server')
  })
})
