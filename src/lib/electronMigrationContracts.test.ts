import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as ipc from './ipc'
import { appShellEventContracts, dynamicShellEventContracts, ipcCommandContracts } from './electronMigrationContracts'

interface ParsedInvokeContract {
  functionName: string
  tauriCommand: string
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
      tauriCommand: commandArgument.text,
      payloadKeys,
    })
  }

  return contracts
}

describe('Electron migration Phase 0 contract inventory', () => {
  it('lists every public runtime ipc.ts function export', () => {
    const exportedFunctions = Object.entries(ipc)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()

    expect(ipcCommandContracts.map(contract => contract.functionName).sort()).toEqual(exportedFunctions)
  })

  it('locks ipc.ts Tauri command names and top-level payload keys', () => {
    const parsedContracts = parseIpcInvokeContracts()
      .map(contract => [contract.functionName, contract] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const inventoriedContracts = ipcCommandContracts
      .map(({ functionName, tauriCommand, payloadKeys }) => [
        functionName,
        { functionName, tauriCommand, payloadKeys: [...payloadKeys] },
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))

    expect(inventoriedContracts).toEqual(parsedContracts)
  })

  it('locks the current app shell event channel names registered by appTauriEventListeners', () => {
    expect(appShellEventContracts.map(contract => contract.eventName)).toEqual([
      'github-sync-complete',
      'review-status-changed',
      'action-complete',
      'implementation-failed',
      'server-resumed',
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

  it('locks high-risk dynamic PTY and plugin event patterns outside appTauriEventListeners', () => {
    expect(dynamicShellEventContracts.map(contract => contract.eventPattern)).toEqual([
      'pty-output-{taskId}',
      'pty-exit-{taskId}',
      'pty-output-{taskId}-shell-{terminalIndex}',
      'pty-exit-{taskId}-shell-{terminalIndex}',
      'plugin:sidecar-exited',
      'plugin:sidecar-failed',
      'whisper-download-progress',
      '{plugin-defined-tauri-event}',
    ])
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-output-{taskId}')).toMatchObject({
      payload: '{ task_id: string; data: string; instance_id: number }',
      transportAfterMigration: 'sse-or-websocket',
    })
    expect(dynamicShellEventContracts.find(contract => contract.eventPattern === 'pty-output-{taskId}-shell-{terminalIndex}')).toMatchObject({
      currentSubscribers: expect.arrayContaining([
        'src/components/task-detail/TaskTerminal.svelte',
        'src/lib/terminalPool.ts',
        'src/lib/plugin/pluginRegistry.ts',
      ]),
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
    expect(appShellEventContracts.find(contract => contract.eventName === 'agent-pty-exited')).toMatchObject({
      payload: '{ task_id: string; success: boolean }',
    })
    expect(appShellEventContracts.find(contract => contract.eventName === 'task-changed')).toMatchObject({
      payload: '{ action: "created" | "updated" | "deleted"; task_id: string } | { action: "cleared_done"; count: number }',
    })
  })

  it('classifies the shell-owned open URL command for Electron main while leaving backend commands on the Rust sidecar', () => {
    expect(ipcCommandContracts.find(contract => contract.functionName === 'openUrl')).toMatchObject({
      tauriCommand: 'open_url',
      targetOwner: 'electron-main',
    })
    expect(ipcCommandContracts.find(contract => contract.functionName === 'createTask')).toMatchObject({
      tauriCommand: 'create_task',
      targetOwner: 'rust-sidecar',
    })
  })
})
