import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
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

function helperSource() {
  return `. ${shellQuote(join(import.meta.dirname, 'openforge-cli-install.sh'))}`
}

async function installScriptWithoutMain() {
  const installScript = await readFile(join(import.meta.dirname, 'install.sh'), 'utf8')
  return installScript.replace(/\nmain "\$@"\s*$/, '\n')
}

function embeddedHelperSnippet(installScript) {
  const match = installScript.match(/# BEGIN embedded OpenForge CLI install helpers \(generated from scripts\/openforge-cli-install\.sh\)\n([\s\S]*?)\n# END embedded OpenForge CLI install helpers/)
  if (!match) throw new Error('Embedded OpenForge CLI helper snippet not found')
  return match[1]
}

async function writeRunner(root, body, prelude = helperSource()) {
  const runner = join(root, 'run-install-helper.sh')
  await writeFile(runner, `#!/bin/sh
set -eu
${prelude}
${body}
`)
  return runner
}

describe('macOS installer CLI helpers', () => {
  it('keeps Electron installer stale sidecar cleanup on the structured failure reporting seam', async () => {
    const installScript = await readFile(join(import.meta.dirname, 'install-electron-mac.sh'), 'utf8')

    expect(installScript).toContain('report_failure')
    expect(installScript).toContain('install:stale-sidecar-cleanup')
    expect(installScript).toContain('Decision: ${decision}')
  })

  it('keeps the release installer embedded helper in sync with the shared helper', async () => {
    const [installScript, sharedHelper] = await Promise.all([
      readFile(join(import.meta.dirname, 'install.sh'), 'utf8'),
      readFile(join(import.meta.dirname, 'openforge-cli-install.sh'), 'utf8')
    ])

    expect(embeddedHelperSnippet(installScript)).toBe(sharedHelper.trimEnd())
  })

  it('keeps release install CLI setup self-contained when no sibling helper file is available', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-standalone-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} warn
`, await installScriptWithoutMain())

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('WARNING: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain('Application Support/openforge/cli/cli.js')
  })

  it('copies the bundled CLI payload into Application Support before writing the launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-${process.pid}-`))
    const home = join(root, 'home with spaces')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    const payloadDir = join(appPath, 'Contents/Resources/openforge-cli')
    const binDir = join(root, 'bin')
    await mkdir(payloadDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')
    await writeFile(join(payloadDir, 'package.json'), '{"type":"module"}\n')
    await writeFile(join(binDir, 'cp'), `#!/bin/sh
if [ -e "${home}/.openforge/bin/openforge" ]; then
  echo "launcher existed before payload copy" >&2
  exit 42
fi
exec /bin/cp "$@"
`)
    await chmod(join(binDir, 'cp'), 0o755)

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
PATH=${shellQuote(`${binDir}:${process.env.PATH ?? ''}`)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    const copiedCli = join(home, 'Library/Application Support/openforge/cli/cli.js')
    await expect(readFile(copiedCli, 'utf8')).resolves.toBe('console.log("openforge cli")\n')
    await expect(readFile(join(home, 'Library/Application Support/openforge/cli/package.json'), 'utf8')).resolves.toBe('{"type":"module"}\n')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain(copiedCli)
  })

  it('propagates payload copy failures without writing the launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-copy-failure-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    const payloadDir = join(appPath, 'Contents/Resources/openforge-cli')
    const binDir = join(root, 'bin')
    await mkdir(payloadDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')
    await writeFile(join(binDir, 'cp'), `#!/bin/sh
echo "simulated payload copy failure" >&2
exit 42
`)
    await chmod(join(binDir, 'cp'), 0o755)

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
PATH=${shellQuote(`${binDir}:${process.env.PATH ?? ''}`)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('simulated payload copy failure')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).rejects.toThrow()
  })

  it('does not write the launcher when strict payload installation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-strict-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ERROR: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).rejects.toThrow()
  })

  it('continues legacy release app installs when the bundled CLI payload is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-legacy-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} warn
`)

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('WARNING: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain('Application Support/openforge/cli/cli.js')
  })
})
