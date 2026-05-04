import { describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from './shellCommands'

describe('Electron shell command handlers', () => {
  it('opens only http and https URLs externally', async () => {
    const openExternal = vi.fn(async () => undefined)

    await openExternalUrl('https://github.com/openforge', openExternal)
    await openExternalUrl('http://localhost:1420', openExternal)

    expect(openExternal).toHaveBeenCalledWith('https://github.com/openforge')
    expect(openExternal).toHaveBeenCalledWith('http://localhost:1420')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/secret',
    'https://',
    'not a url',
  ])('rejects unsafe external URL %s', async (url) => {
    const openExternal = vi.fn(async () => undefined)

    await expect(openExternalUrl(url, openExternal)).rejects.toThrow('open_url only supports http and https URLs')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
