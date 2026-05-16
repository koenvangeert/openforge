import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dialog } from 'electron'
import { bootOpenForgeDesktop } from './bootLifecycle.js'
import { createElectronBootAdapter } from './electronBootAdapter.js'
import { ElectronFailureReporterAdapter, createFailureReport, reportFailure } from './failureReporting.js'

function currentDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

function workspaceRoot(): string {
  return join(currentDir(), '..')
}

const failureReporter = new ElectronFailureReporterAdapter({
  showErrorBox: (title, content) => dialog.showErrorBox(title, content),
})

const adapter = createElectronBootAdapter({
  currentDir: currentDir(),
  workspaceRoot: workspaceRoot(),
  env: process.env,
  failureReporter,
})

void bootOpenForgeDesktop(adapter, {
  platform: process.platform,
  warnOnMissingSidecar: !process.env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR,
  failureReporter,
}).catch(async error => {
  await reportFailure(failureReporter, createFailureReport({
    phase: 'boot:main',
    severity: 'fatal',
    cause: error,
    userMessage: 'OpenForge failed during desktop launch.',
    remediation: 'Restart OpenForge. If this repeats, check Electron and sidecar logs for the reported phase.',
    decision: 'quit',
  }))
  adapter.quit()
})
