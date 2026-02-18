import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    alias: {
      '@tauri-apps/api/core': new URL('./src/__mocks__/@tauri-apps/api/core.ts', import.meta.url).pathname,
      '@tauri-apps/api/event': new URL('./src/__mocks__/@tauri-apps/api/event.ts', import.meta.url).pathname,
    },
  },
})
