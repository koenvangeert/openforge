import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { compile } from 'svelte/compiler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalProjectView from './TerminalProjectView.svelte'

const { terminalTabsApi, cleanupSideEffects } = vi.hoisted(() => ({
  terminalTabsApi: {
    addTab: vi.fn(),
    closeActiveTab: vi.fn().mockResolvedValue(undefined),
    focusActiveTab: vi.fn(),
    switchToTab: vi.fn(),
  },
  cleanupSideEffects: {
    killPty: vi.fn(),
    releaseAllForTask: vi.fn(),
    clearTaskTerminalTabsSession: vi.fn(),
  },
}))

vi.mock('./lib/ipc', () => ({
  killPty: cleanupSideEffects.killPty,
}))

vi.mock('./lib/terminalPool', () => ({
  releaseAllForTask: cleanupSideEffects.releaseAllForTask,
  clearTaskTerminalTabsSession: cleanupSideEffects.clearTaskTerminalTabsSession,
}))

vi.mock('./TerminalTabs.svelte', () => ({
  default: vi.fn(() => ({
    update() {},
    destroy() {},
    ...terminalTabsApi,
  })),
}))

function resetMocks() {
  terminalTabsApi.addTab.mockClear()
  terminalTabsApi.closeActiveTab.mockClear()
  terminalTabsApi.focusActiveTab.mockClear()
  terminalTabsApi.switchToTab.mockClear()
  cleanupSideEffects.killPty.mockClear()
  cleanupSideEffects.releaseAllForTask.mockClear()
  cleanupSideEffects.clearTaskTerminalTabsSession.mockClear()
}

function expectNoProjectTerminalCleanup() {
  expect(cleanupSideEffects.killPty).not.toHaveBeenCalled()
  expect(cleanupSideEffects.releaseAllForTask).not.toHaveBeenCalled()
  expect(cleanupSideEffects.clearTaskTerminalTabsSession).not.toHaveBeenCalled()
}

function makeKeyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

function renderProjectTerminalView() {
  render(TerminalProjectView, {
    props: {
      projectId: 'P-123',
      projectName: 'Demo',
      projectPath: '/tmp/demo',
    },
  })
}

function readTerminalProjectViewSource(): string {
  const path = [
    resolve(process.cwd(), 'plugins/terminal/src/TerminalProjectView.svelte'),
    resolve(process.cwd(), 'src/TerminalProjectView.svelte'),
  ].find((candidate) => existsSync(candidate))

  if (!path) throw new Error('TerminalProjectView.svelte not found')

  return readFileSync(path, 'utf8')
}

describe('TerminalProjectView', () => {
  it('does not produce non-reactive bind:this compiler warnings', () => {
    const source = readTerminalProjectViewSource()
    const { js, warnings } = compile(source, {
      filename: 'TerminalProjectView.svelte',
      generate: 'client',
      dev: true,
    })

    expect(warnings.map((warning) => warning.code)).not.toContain('binding_property_non_reactive')
    expect(js.code).not.toContain("$.validate_binding('bind:this=")
  })

  afterEach(() => {
    cleanup()
    resetMocks()
    vi.restoreAllMocks()
  })

  it('handles Cmd+T for project terminal tabs', async () => {
    renderProjectTerminalView()

    const event = makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true })
    window.dispatchEvent(event)

    expect(terminalTabsApi.addTab).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('handles Cmd+Shift+digit for project terminal tab switching', async () => {
    renderProjectTerminalView()

    const event = makeKeyEvent({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true })
    window.dispatchEvent(event)

    expect(terminalTabsApi.switchToTab).toHaveBeenCalledWith(2)
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps project terminal sessions alive when navigating away from and back to the same terminal view', async () => {
    const first = render(TerminalProjectView, {
      props: {
        projectId: 'P-123',
        projectName: 'Demo',
        projectPath: '/tmp/demo',
      },
    })

    first.unmount()
    await tick()

    render(TerminalProjectView, {
      props: {
        projectId: 'P-123',
        projectName: 'Demo',
        projectPath: '/tmp/demo',
      },
    })
    await tick()

    expectNoProjectTerminalCleanup()
  })

  it('keeps the previous project terminal alive when switching projects after navigating away', async () => {
    const first = render(TerminalProjectView, {
      props: {
        projectId: 'P-123',
        projectName: 'Demo',
        projectPath: '/tmp/demo',
      },
    })

    first.unmount()
    await tick()

    render(TerminalProjectView, {
      props: {
        projectId: 'P-456',
        projectName: 'Other',
        projectPath: '/tmp/other',
      },
    })
    await tick()

    expectNoProjectTerminalCleanup()
  })

  it('keeps the previous project terminal alive when switching to a different project', async () => {
    const { rerender } = render(TerminalProjectView, {
      props: {
        projectId: 'P-123',
        projectName: 'Demo',
        projectPath: '/tmp/demo',
      },
    })

    await rerender({
      projectId: 'P-456',
      projectName: 'Other',
      projectPath: '/tmp/other',
    })
    await tick()

    expectNoProjectTerminalCleanup()
  })
})
