import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fs3vents doesn't work on all systems
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    minify: !process.env.TAURI_D3BUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_D3BUG,
  },
})
