import { describe, expect, it, vi } from 'vitest'

describe('shared Vitest test setup', () => {
  it('provides a quiet test-safe canvas 2d context stub', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      expect(context).not.toBeNull()
      expect(context?.measureText('OpenForge').width).toBeGreaterThan(0)
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps the canvas getContext stub configurable for tests that need custom behavior', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const customGetContext = vi.fn().mockReturnValue({ custom: true })

    try {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: customGetContext,
        configurable: true,
      })

      expect(document.createElement('canvas').getContext('2d')).toEqual({ custom: true })
      expect(customGetContext).toHaveBeenCalledWith('2d')
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: originalGetContext,
        configurable: true,
      })
    }
  })
})
