import { describe, expect, it } from 'vitest'
import { shouldGrantMediaPermission } from './mediaPermission'

describe('Electron media permission policy', () => {
  it('grants microphone capture only to the trusted main renderer', () => {
    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins: new Set(['http://localhost:1420']),
      mediaTypes: ['audio'],
    })).toBe(true)
  })

  it('denies camera capture even from the trusted main renderer', () => {
    const trustedOrigins = new Set(['http://localhost:1420'])

    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins,
      mediaTypes: ['video'],
    })).toBe(false)
    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins,
      mediaTypes: ['audio', 'video'],
    })).toBe(false)
  })

  it('denies media requests when Electron does not provide an audio subtype', () => {
    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins: new Set(['http://localhost:1420']),
    })).toBe(false)
  })

  it('denies non-media permissions and media requests from other renderers or origins', () => {
    const trustedOrigins = new Set(['http://localhost:1420'])

    expect(shouldGrantMediaPermission({
      permission: 'notifications',
      isMainWindowWebContents: true,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins,
    })).toBe(false)
    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: false,
      requestingUrl: 'http://localhost:1420/tasks',
      trustedOrigins,
      mediaTypes: ['audio'],
    })).toBe(false)
    expect(shouldGrantMediaPermission({
      permission: 'media',
      isMainWindowWebContents: true,
      requestingUrl: 'https://evil.example/tasks',
      trustedOrigins,
      mediaTypes: ['audio'],
    })).toBe(false)
  })
})
