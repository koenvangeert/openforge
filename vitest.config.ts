import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    // The task-detail/SelfReviewView Svelte/jsdom suites can leave the default
    // worker pool waiting on teardown in some local runs. Forked workers finish
    // these suites reliably and keep `pnpm test` aligned with the known-good
    // `pnpm exec vitest --pool=forks` path.
    pool: 'forks',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    include: [
      'src/**/*.test.ts',
      'plugins/file-viewer/src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'src-tauri/src/openforge-cli/**/*.test.js',
    ],
    alias: {
      '@openforge/plugin-sdk/domain': new URL('./packages/plugin-sdk/src/domain.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/numberParsing': new URL('./packages/plugin-sdk/src/numberParsing.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/sanitize': new URL('./packages/plugin-sdk/src/sanitize.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/MarkdownContent.svelte': new URL('./packages/plugin-sdk/src/ui/MarkdownContent.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/ResizablePanel.svelte': new URL('./packages/plugin-sdk/src/ui/ResizablePanel.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk': new URL('./packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})
