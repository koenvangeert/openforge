import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ensureDevPluginArtifacts } from './build-dev-plugin-artifacts.mjs'

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

async function makeWorkspace() {
  const root = await mkdir(path.join(tmpdir(), `openforge-dev-plugin-artifacts-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true })

  await write(root, 'packages/plugin-sdk/src/index.ts', 'export const sdk = 1\n')
  await write(root, 'packages/plugin-sdk/package.json', '{"name":"@openforge/plugin-sdk"}\n')
  await write(root, 'packages/plugin-sdk/tsconfig.json', '{}\n')
  await write(root, 'scripts/build-plugin-sdk-runtime.mjs', 'export async function buildPluginSdkRuntime() {}\n')

  await write(root, 'plugins/demo/package.json', '{"scripts":{"build":"vite build"}}\n')
  await write(root, 'plugins/demo/src/index.ts', 'export const demo = 1\n')
  await write(root, 'plugins/demo/manifest.json', '{"id":"demo"}\n')
  await write(root, 'plugins/demo/tsconfig.json', '{}\n')

  await write(root, 'plugins/host-bundled/package.json', '{"scripts":{"test":"vitest run"}}\n')
  await write(root, 'plugins/host-bundled/src/index.ts', 'export const hostBundled = 1\n')
  await write(root, 'plugins/host-bundled/manifest.json', '{"id":"host-bundled"}\n')

  return root
}

async function createPluginArtifacts(root) {
  await write(root, 'plugins/demo/dist/index.js', 'demo bundle\n')
}

async function runWithCommands(root) {
  const commands = []
  const sdkRuntimeBuilds = []

  const result = await ensureDevPluginArtifacts({
    workspaceRoot: root,
    log: () => {},
    buildSdkRuntime: async (options) => {
      sdkRuntimeBuilds.push({
        workspaceRoot: options.workspaceRoot,
        outDir: path.relative(root, options.outDir),
      })
      await write(root, 'src-tauri/plugin-host/plugin-sdk/index.js', 'sdk runtime\n')
      return path.join(options.outDir, 'index.js')
    },
    runCommand: async (command, args, options) => {
      commands.push({ command, args, cwd: options.cwd })
      await createPluginArtifacts(root)
    },
  })

  return { result, commands, sdkRuntimeBuilds }
}

describe('incremental dev plugin artifact builds', () => {
  it('runs both dev artifact builds on a cold workspace and then skips unchanged inputs', async () => {
    const root = await makeWorkspace()

    try {
      const first = await runWithCommands(root)

      expect(first.sdkRuntimeBuilds).toEqual([
        {
          workspaceRoot: root,
          outDir: path.join('src-tauri', 'plugin-host', 'plugin-sdk'),
        },
      ])
      expect(first.commands.map((command) => [command.command, ...command.args].join(' '))).toEqual([
        'pnpm build:plugins',
      ])
      expect(first.result.sdkRuntime.rebuilt).toBe(true)
      expect(first.result.bundledPlugins.rebuilt).toBe(true)

      const second = await runWithCommands(root)

      expect(second.sdkRuntimeBuilds).toEqual([])
      expect(second.commands).toEqual([])
      expect(second.result.sdkRuntime.rebuilt).toBe(false)
      expect(second.result.bundledPlugins.rebuilt).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rebuilds the plugin SDK runtime and plugin bundles when shared SDK source inputs change', async () => {
    const root = await makeWorkspace()

    try {
      await runWithCommands(root)
      await write(root, 'packages/plugin-sdk/src/index.ts', 'export const sdk = 2\n')

      const update = await runWithCommands(root)

      expect(update.sdkRuntimeBuilds).toEqual([
        {
          workspaceRoot: root,
          outDir: path.join('src-tauri', 'plugin-host', 'plugin-sdk'),
        },
      ])
      expect(update.commands.map((command) => [command.command, ...command.args].join(' '))).toEqual([
        'pnpm build:plugins',
      ])
      expect(update.result.sdkRuntime.reason).toBe('inputs-changed')
      expect(update.result.bundledPlugins.reason).toBe('inputs-changed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rebuilds only build-script plugin packages when their source inputs change', async () => {
    const root = await makeWorkspace()

    try {
      await runWithCommands(root)
      await write(root, 'plugins/demo/src/index.ts', 'export const demo = 2\n')

      const update = await runWithCommands(root)

      expect(update.sdkRuntimeBuilds).toEqual([])
      expect(update.commands.map((command) => [command.command, ...command.args].join(' '))).toEqual([
        'pnpm build:plugins',
      ])
      expect(update.result.sdkRuntime.rebuilt).toBe(false)
      expect(update.result.bundledPlugins.reason).toBe('inputs-changed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not run build:plugins for host-bundled plugin sources without build scripts', async () => {
    const root = await makeWorkspace()

    try {
      await runWithCommands(root)
      await write(root, 'plugins/host-bundled/src/index.ts', 'export const hostBundled = 2\n')

      const update = await runWithCommands(root)

      expect(update.sdkRuntimeBuilds).toEqual([])
      expect(update.commands).toEqual([])
      expect(update.result.bundledPlugins.rebuilt).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('builds the remaining Tauri dev runtime with an explicit legacy output path', async () => {
    const root = await makeWorkspace()

    try {
      const update = await runWithCommands(root)

      expect(update.sdkRuntimeBuilds).toEqual([
        {
          workspaceRoot: root,
          outDir: path.join('src-tauri', 'plugin-host', 'plugin-sdk'),
        },
      ])
      await expect(readFile(path.join(root, 'src-tauri/plugin-host/plugin-sdk/index.js'), 'utf8')).resolves.toBe('sdk runtime\n')
      await expect(readFile(path.join(root, 'dist-electron/plugin-host/plugin-sdk/index.js'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records source input paths that triggered the current state', async () => {
    const root = await makeWorkspace()

    try {
      await runWithCommands(root)
      const state = JSON.parse(await readFile(path.join(root, '.a5c/cache/dev-plugin-artifacts.json'), 'utf8'))

      expect(state.sdkRuntime.inputPaths).toContain('packages/plugin-sdk/src/index.ts')
      expect(state.bundledPlugins.inputPaths).toContain('plugins/demo/src/index.ts')
      expect(state.bundledPlugins.inputPaths).not.toContain('plugins/host-bundled/src/index.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
