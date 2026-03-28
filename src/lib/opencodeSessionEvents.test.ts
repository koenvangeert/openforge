import { describe, expect, it } from 'vitest'

import { getOpenCodeSessionUpdate } from './opencodeSessionEvents'

describe('getOpenCodeSessionUpdate', () => {
  it('does not mark a raw session.idle event as completed', () => {
    expect(getOpenCodeSessionUpdate('session.idle', '{"type":"session.idle"}')).toBeNull()
  })

  it('does not mark a raw session.status idle payload as completed', () => {
    const payload = JSON.stringify({ properties: { status: { type: 'idle' } } })
    expect(getOpenCodeSessionUpdate('session.status', payload)).toBeNull()
  })

  it('maps busy session.status payloads to running', () => {
    const payload = JSON.stringify({ properties: { status: { type: 'busy' } } })
    expect(getOpenCodeSessionUpdate('session.status', payload)).toEqual({
      status: 'running',
      checkpoint_data: null,
    })
  })

  it('maps retry session.status payloads to running', () => {
    const payload = JSON.stringify({ properties: { status: { type: 'retry' } } })
    expect(getOpenCodeSessionUpdate('session.status', payload)).toEqual({
      status: 'running',
      checkpoint_data: null,
    })
  })

  it('maps question and permission request events to paused', () => {
    expect(getOpenCodeSessionUpdate('question.asked', 'Need approval')).toEqual({
      status: 'paused',
      checkpoint_data: 'Need approval',
    })

    expect(getOpenCodeSessionUpdate('permission.asked', 'Need permission')).toEqual({
      status: 'paused',
      checkpoint_data: 'Need permission',
    })

    expect(getOpenCodeSessionUpdate('permission.updated', 'Need permission')).toEqual({
      status: 'paused',
      checkpoint_data: 'Need permission',
    })
  })

  it('maps reply and reject events back to running', () => {
    expect(getOpenCodeSessionUpdate('question.replied', 'approved')).toEqual({
      status: 'running',
      checkpoint_data: null,
    })

    expect(getOpenCodeSessionUpdate('question.rejected', 'denied')).toEqual({
      status: 'running',
      checkpoint_data: null,
    })

    expect(getOpenCodeSessionUpdate('question.answered', 'approved')).toEqual({
      status: 'running',
      checkpoint_data: null,
    })

    expect(getOpenCodeSessionUpdate('permission.replied', 'approved')).toEqual({
      status: 'running',
      checkpoint_data: null,
    })
  })

  it('maps session.error to failed', () => {
    expect(getOpenCodeSessionUpdate('session.error', 'boom')).toEqual({
      status: 'failed',
      error_message: 'boom',
    })
  })
})
