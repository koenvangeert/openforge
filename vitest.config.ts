import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'src-tauri/src/mcp-server/**/*.test.js'],
    alias: {
      '@tauri-apps/api/core': new URL('./src/__mocks__/@tauri-apps/api/core.ts', import.meta.url).pathname,
      '@tauri-apps/api/event': new URL('./src/__mocks__/@tauri-apps/api/event.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/domain': new URL('./packages/plugin-sdk/src/domain.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/numberParsing': new URL('./packages/plugin-sdk/src/numberParsing.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/sanitize': new URL('./packages/plugin-sdk/src/sanitize.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/MarkdownContent.svelte': new URL('./packages/plugin-sdk/src/ui/MarkdownContent.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/ResizablePanel.svelte': new URL('./packages/plugin-sdk/src/ui/ResizablePanel.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk': new URL('./packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})
