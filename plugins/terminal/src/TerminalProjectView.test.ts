import { cleanup, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalProjectView from './TerminalProjectView.svelte'
import { resetActiveProjectTerminalTask } from './lib/projectTerminal'

const { terminalTabsApi, cleanupProjectTerminalTaskMock } = vi.hoisted(() => ({
  terminalTabsApi: {
    addTab: vi.fn(),
    closeActiveTab: vi.fn().mockResolvedValue(undefined),
    focusActiveTab: vi.fn(),
    switchToTab: vi.fn(),
  },
  cleanupProjectTerminalTaskMock: vi.fn().mockResolvedValue({ killed: 0, released: 0, killFailures: [] }),
}))

vi.mock('./lib/projectTerminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/projectTerminal')>()
  return {
    ...actual,
    cleanupProjectTerminalTask: cleanupProjectTerminalTaskMock,
  }
})

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
  cleanupProjectTerminalTaskMock.mockClear()
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

describe('TerminalProjectView', () => {
  afterEach(() => {
    cleanup()
    resetActiveProjectTerminalTask()
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

    expect(cleanupProjectTerminalTaskMock).not.toHaveBeenCalled()
  })

  it('cleans up the previous project terminal when switching projects after navigating away', async () => {
    const first = render(TerminalProjectView, {
      props: {
        projectId: 'P-123',
        projectName: 'Demo',
        projectPath: '/tmp/demo',
      },
    })

    first.unmount()
    await tick()

    expect(cleanupProjectTerminalTaskMock).not.toHaveBeenCalled()

    render(TerminalProjectView, {
      props: {
        projectId: 'P-456',
        projectName: 'Other',
        projectPath: '/tmp/other',
      },
    })
    await tick()

    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledTimes(1)
    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledWith('project-P-123', expect.any(Object))
  })

  it('cleans up the previous project terminal when switching to a different project', async () => {
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

    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledTimes(1)
    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledWith('project-P-123', expect.any(Object))
  })
})
