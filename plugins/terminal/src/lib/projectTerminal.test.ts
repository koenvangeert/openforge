import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupProjectTerminalTask,
  getProjectTerminalTaskId,
  markActiveProjectTerminalTask,
  releaseInactiveProjectTerminalTask,
  resetActiveProjectTerminalTask,
} from './projectTerminal'

describe('projectTerminal', () => {
  afterEach(() => {
    resetActiveProjectTerminalTask()
  })

  it('uses a project-scoped terminal task id so main terminals do not collide with task terminals', () => {
    expect(getProjectTerminalTaskId('P-123')).toBe('project-P-123')
  })

  it('remembers the active project terminal task across view remounts without cleaning up the same task', () => {
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
  })

  it('returns the previous project terminal task when a different project becomes active', () => {
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
    expect(markActiveProjectTerminalTask('project-P-456')).toBe('project-P-123')
  })

  it('returns the previous project terminal task when no project remains active', () => {
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
    expect(markActiveProjectTerminalTask(null)).toBe('project-P-123')
    expect(markActiveProjectTerminalTask('project-P-456')).toBeNull()
  })

  it('releases an opened project terminal when navigation moves to another project without marking the next project opened', () => {
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
    expect(releaseInactiveProjectTerminalTask('project-P-456')).toBe('project-P-123')
    expect(releaseInactiveProjectTerminalTask('project-P-789')).toBeNull()
  })

  it('does not release an opened project terminal when navigation remains on the same project', () => {
    expect(markActiveProjectTerminalTask('project-P-123')).toBeNull()
    expect(releaseInactiveProjectTerminalTask('project-P-123')).toBeNull()
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
