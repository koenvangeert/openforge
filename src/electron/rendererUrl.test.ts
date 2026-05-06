import { describe, expect, it } from 'vitest'
import { trustedRendererUrlFromEnv } from './rendererUrl'

describe('trustedRendererUrlFromEnv', () => {
  it('accepts loopback Vite dev server URLs on configured ports', () => {
    expect(trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://localhost:1420' })).toBe('http://localhost:1420/')
    expect(trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://127.0.0.1:1431/' })).toBe('http://127.0.0.1:1431/')
  })

  it('rejects untrusted renderer URLs before exposing the preload bridge', () => {
    expect(() => trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'https://example.com' })).toThrow('trusted loopback Vite dev server')
    expect(() => trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://192.168.1.2:1420' })).toThrow('trusted loopback Vite dev server')
    expect(() => trustedRendererUrlFromEnv({ ELECTRON_RENDERER_URL: 'http://localhost' })).toThrow('explicit port')
  })
})
