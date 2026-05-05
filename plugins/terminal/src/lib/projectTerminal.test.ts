import { describe, expect, it, vi } from 'vitest'
import {
  cleanupProjectTerminalTask,
  getProjectTerminalTaskId,
} from './projectTerminal'

describe('projectTerminal', () => {
  it('uses a project-scoped terminal task id so main terminals do not collide with task terminals', () => {
    expect(getProjectTerminalTaskId('P-123')).toBe('project-P-123')
  })

  it('cleans up every shell tab, releases pool entries, and clears the session for a project terminal task', async () => {
    const deps = {
      getTaskTerminalTabsSession: vi.fn(() => ({
        tabs: [
          { index: 0, key: 'project-P-123-shell-0', label: 'Shell 1' },
          { index: 1, key: 'project-P-123-shell-1', label: 'Shell 2' },
        ],
        activeTabIndex: 1,
        nextIndex: 2,
      })),
      killPty: vi.fn(async () => undefined),
      releaseAllForTask: vi.fn(() => 2),
      clearTaskTerminalTabsSession: vi.fn(),
    }

    const result = await cleanupProjectTerminalTask('project-P-123', deps)

    expect(deps.killPty).toHaveBeenCalledTimes(2)
    expect(deps.killPty).toHaveBeenNthCalledWith(1, 'project-P-123-shell-0')
    expect(deps.killPty).toHaveBeenNthCalledWith(2, 'project-P-123-shell-1')
    expect(deps.releaseAllForTask).toHaveBeenCalledWith('project-P-123')
    expect(deps.clearTaskTerminalTabsSession).toHaveBeenCalledWith('project-P-123')
    expect(result).toEqual({ killed: 2, released: 2, killFailures: [] })
  })

  it('still releases pool entries and clears session when killing one shell fails', async () => {
    const deps = {
      getTaskTerminalTabsSession: vi.fn(() => ({
        tabs: [
          { index: 0, key: 'project-P-123-shell-0', label: 'Shell 1' },
          { index: 1, key: 'project-P-123-shell-1', label: 'Shell 2' },
        ],
        activeTabIndex: 0,
        nextIndex: 2,
      })),
      killPty: vi.fn(async (key: string) => {
        if (key.endsWith('-1')) throw new Error('already exited')
      }),
      releaseAllForTask: vi.fn(() => 2),
      clearTaskTerminalTabsSession: vi.fn(),
    }

    const result = await cleanupProjectTerminalTask('project-P-123', deps)

    expect(deps.killPty).toHaveBeenCalledTimes(2)
    expect(deps.releaseAllForTask).toHaveBeenCalledWith('project-P-123')
    expect(deps.clearTaskTerminalTabsSession).toHaveBeenCalledWith('project-P-123')
    expect(result).toEqual({
      killed: 1,
      released: 2,
      killFailures: [{ key: 'project-P-123-shell-1', error: 'already exited' }],
    })
  })
})
