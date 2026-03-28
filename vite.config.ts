import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { createOpenForgeChunkGroups, OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT } from './src/lib/viteChunks'
import { createOpenForgeViteLogger } from './src/lib/viteLogger'

// https://vitejs.dev/config/
export default defineConfig({
  // Temporary workaround for Lightning CSS 1.32.0 false-positive
  // ::highlight(...) warnings until the upstream fix is released through Vite.
  customLogger: createOpenForgeViteLogger(),
  plugins: [tailwindcss(), svelte()],
  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fsEvents doesn't work on all systems
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Raise the limit to suppress two known-large-but-unavoidable chunks:
    //   - vendor-diff  (~1,086 kB): @git-diff-view/lowlight bundles all
    //     highlight.js language grammars — no meaningful split possible.
    //   - diffWorker   (~960 kB):   same lowlight dep in the Web Worker.
    // Tauri loads assets from disk — no network transfer cost, so these
    // sizes are not a real perf problem, only a bundler noise warning.
    chunkSizeWarningLimit: OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: createOpenForgeChunkGroups(),
        },
      },
    },
  },
})
