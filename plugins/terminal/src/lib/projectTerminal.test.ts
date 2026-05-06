import { describe, expect, it } from 'vitest'
import * as projectTerminal from './projectTerminal'

const { getProjectTerminalTaskId } = projectTerminal

describe('projectTerminal', () => {
  it('uses a project-scoped terminal task id so main terminals do not collide with task terminals', () => {
    expect(getProjectTerminalTaskId('P-123')).toBe('project-P-123')
  })

  it('keeps project terminal utilities limited to id generation until an explicit cleanup lifecycle exists', () => {
    expect(Object.keys(projectTerminal).sort()).toEqual(['getProjectTerminalTaskId'])
  })
})
