import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    alias: {
      '@openforge/plugin-sdk/domain': new URL('../../packages/plugin-sdk/src/domain.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/numberParsing': new URL('../../packages/plugin-sdk/src/numberParsing.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/sanitize': new URL('../../packages/plugin-sdk/src/sanitize.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/MarkdownContent.svelte': new URL('../../packages/plugin-sdk/src/ui/MarkdownContent.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/ResizablePanel.svelte': new URL('../../packages/plugin-sdk/src/ui/ResizablePanel.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk': new URL('../../packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})
