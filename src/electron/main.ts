import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootOpenForgeDesktop } from './bootLifecycle.js'
import { createElectronBootAdapter } from './electronBootAdapter.js'

function currentDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

function workspaceRoot(): string {
  return join(currentDir(), '..')
}

const adapter = createElectronBootAdapter({
  currentDir: currentDir(),
  workspaceRoot: workspaceRoot(),
  env: process.env,
})

void bootOpenForgeDesktop(adapter, {
  platform: process.platform,
  warnOnMissingSidecar: !process.env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR,
}).catch(error => {
  console.error('[electron] OpenForge boot failed:', error)
  adapter.quit()
})
