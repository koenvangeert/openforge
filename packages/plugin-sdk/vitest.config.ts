import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    alias: {
      '@tauri-apps/api/core': new URL('../../src/__mocks__/@tauri-apps/api/core.ts', import.meta.url).pathname,
    },
  },
})
