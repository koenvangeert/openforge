import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as ipc from './ipc'
import { appShellEventContracts, dynamicShellEventContracts, ipcCommandContracts } from './electronMigrationContracts'

interface ParsedInvokeContract {
  functionName: string
  ipcCommand: string
  payloadKeys: string[]
}

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(sourceFile)
}

function findFirstInvoke(node: ts.Node): ts.CallExpression | null {
  let found: ts.CallExpression | null = null

  function visit(child: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'invoke') {
      found = child
      return
    }
    ts.forEachChild(child, visit)
  }

  ts.forEachChild(node, visit)
  return found
}

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory).sort()
  const files: string[] = []

  for (const entry of entries) {
    const path = resolve(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === '__mocks__') continue
      files.push(...collectSourceFiles(path))
      continue
    }

    if (!/\.(svelte|ts)$/.test(entry)) continue
    files.push(path)
  }

  return files
}

function rawEventBoundaryCandidateFiles(): string[] {
  return [
    ...collectSourceFiles(resolve(process.cwd(), 'src')),
    resolve(process.cwd(), 'vitest.config.ts'),
    resolve(process.cwd(), 'packages/plugin-sdk/vitest.config.ts'),
  ]
}

function parseIpcInvokeContracts(): ParsedInvokeContract[] {
  const sourcePath = resolve(process.cwd(), 'src/lib/ipc.ts')
  const sourceText = readFileSync(sourcePath, 'utf8')
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const contracts: ParsedInvokeContract[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
    const isExported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue

    const invokeCall = findFirstInvoke(statement)
    if (!invokeCall) continue

    const commandArgument = invokeCall.arguments[0]
    if (!commandArgument || !ts.isStringLiteral(commandArgument)) continue

    const payloadArgument = invokeCall.arguments[1]
    const payloadKeys = payloadArgument && ts.isObjectLiteralExpression(payloadArgument)
      ? payloadArgument.properties.map((property) => {
        if (ts.isShorthandPropertyAssignment(property)) return property.name.text
        if (ts.isPropertyAssignment(property)) return propertyName(property.name, sourceFile)
        return property.getText(sourceFile)
      })
      : []

    contracts.push({
      functionName: statement.name.text,
      ipcCommand: commandArgument.text,
      payloadKeys,
    })
  }

  return contracts
}

describe('Electron migration Phase 0 contract inventory', () => {
  it('keeps renderer event subscriptions and Vitest seams behind the Electron desktop IPC adapter', () => {
    const forbiddenDesktopRuntimeImport = '@tauri' + '-apps/api'
    const offenders = rawEventBoundaryCandidateFiles()
      .map(file => ({ file: relative(process.cwd(), file).split('\\').join('/'), source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => source.includes(forbiddenDesktopRuntimeImport))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('lists every public runtime ipc.ts function export', () => {
    const exportedFunctions = Object.entries(ipc)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()

    expect(ipcCommandContracts.map(contract => contract.functionName).sort()).toEqual(exportedFunctions)
  })

  it('locks ipc.ts IPC command names and top-level payload keys', () => {
    const parsedContracts = parseIpcInvokeContracts()
      .map(contract => [contract.functionName, contract] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const inventoriedContracts = ipcCommandContracts
      .map(({ functionName, ipcCommand, payloadKeys }) => [
        functionName,
        { functionName, ipcCommand, payloadKeys: [...payloadKeys] },
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))

    expect(inventoriedContracts).toEqual(parsedContracts)
  })

  it('locks the current app shell event channel names registered by appDesktopEventListeners', () => {
    expect(appShellEventContracts.map(contract => contract.eventName)).toEqual([
      'github-sync-complete',
      'openforge-app-events-gap',
      'review-status-changed',
      'action-complete',
      'implementation-failed',
      'session-resumed',
      'startup-resume-complete',
      'new-pr-comment',
      'comment-addressed',
      'ci-status-changed',
      'agent-event',
      'session-aborted',
      'agent-status-changed',
      'agent-pty-exited',
      'review-pr-count-changed',
      'authored-prs-updated',
      'github-rate-limited',
      'task-changed',
    ])
  })

  it('locks high-risk dynamic PTY and plugin event patterns outside appDesktopEventListeners', () => {
    expect(dynamicShellEventContracts.map(contract => contract.eventPattern)).toEqual([
      'pty-output-{taskId}',
      'pty-exit-{taskId}',
      'pty-output-{taskId}-shell-{terminalIndex}',
      'pty-exit-{taskId}-shell-{terminalIndex}',
      'plugin:sidecar-exited',
      'plugin:sidecar-failed',
      'whisper-download-progress',
      '{plugin-defined-desktop-event}',
    ])
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-output-{taskId}')).toMatchObject({
      currentSubscribers: ['src/lib/terminalPool.ts'],
      payload: '{ task_id: string; data: string; instance_id: number }',
      transportAfterMigration: 'sse-or-websocket',
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-exit-{taskId}')).toMatchObject({
      currentSubscribers: ['src/lib/terminalPool.ts'],
      payload: '{ instance_id: number }',
      transportAfterMigration: 'sse-or-websocket',
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-output-{taskId}-shell-{terminalIndex}')).toMatchObject({
      currentSubscribers: ['src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-exit-{taskId}-shell-{terminalIndex}')).toMatchObject({
      currentSubscribers: ['src/components/task-detail/TaskTerminal.svelte', 'src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'plugin:sidecar-exited')).toMatchObject({
      domain: 'plugins',
      payload: '{ code: number | null; signal: number | null; pid: number | null; retry_attempts: number }',
      transportAfterMigration: 'plugin-event-adapter',
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'plugin:sidecar-failed')).toMatchObject({
      domain: 'plugins',
      payload: '{ error: string | null; retry_attempts: number }',
      transportAfterMigration: 'plugin-event-adapter',
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'whisper-download-progress')).toMatchObject({
      domain: 'whisper-audio',
      payload: '{ model_size: string; bytes_downloaded: number; total_bytes: number; percentage: number }',
      transportAfterMigration: 'sse-or-websocket',
    })
  })

  it('locks known non-obvious event payload shapes', () => {
    expect(appShellEventContracts.find(contract => contract.eventName === 'session-resumed')).toMatchObject({
      payload: '{ task_id: string; workspace_path: string }',
    })
    expect(appShellEventContracts.find(contract => contract.eventName === 'agent-pty-exited')).toMatchObject({
      payload: '{ task_id: string; success: boolean }',
    })
    expect(appShellEventContracts.find(contract => contract.eventName === 'task-changed')).toMatchObject({
      payload: '{ action: "created" | "updated" | "deleted"; task_id: string } | { action: "cleared_done"; count: number }',
    })
  })

  it('classifies the shell-owned app shell commands for Electron main while leaving backend commands on the Rust sidecar', () => {
    expect(ipcCommandContracts.find(contract => contract.functionName === 'openUrl')).toMatchObject({
      ipcCommand: 'open_url',
      targetOwner: 'electron-main',
    })
    expect(ipcCommandContracts.find(contract => contract.functionName === 'quitApp')).toMatchObject({
      ipcCommand: 'quit_app',
      targetOwner: 'electron-main',
    })
    expect(ipcCommandContracts.find(contract => contract.functionName === 'createTask')).toMatchObject({
      ipcCommand: 'create_task',
      targetOwner: 'rust-sidecar',
    })
  })
})
