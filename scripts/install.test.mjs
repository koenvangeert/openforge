import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function runShell(scriptPath) {
  return new Promise(resolve => {
    const child = spawn('sh', [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

async function installScriptHelpers() {
  const installScript = await readFile(join(import.meta.dirname, 'install.sh'), 'utf8')
  return installScript.replace(/\nmain "\$@"\s*$/, '\n')
}

describe('release installer CLI payload compatibility', () => {
  it('continues legacy app installs when the bundled CLI payload is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-legacy-${process.pid}-`))
    const home = join(root, 'home')
    const installDir = join(root, 'Applications')
    await mkdir(join(installDir, 'Open Forge.app'), { recursive: true })

    const runner = join(root, 'run-install-helper.sh')
    await writeFile(runner, `${await installScriptHelpers()}
HOME=${shellQuote(home)}
INSTALL_DIR=${shellQuote(installDir)}
APP_NAME='Open Forge'
install_cli_payload
install_cli_launcher
`)

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain('Application Support/openforge/cli/cli.js')
  })
})
