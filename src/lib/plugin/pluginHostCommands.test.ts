import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokePluginHostCommand } from './pluginHostCommands'

function installDesktopBridge(result: unknown = []): { invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn().mockResolvedValue(result)
  window.openforge = {
    version: 1,
    invoke,
    onEvent: vi.fn(() => vi.fn()),
  }
  return { invoke }
}

describe('plugin host GitHub agent review commands', () => {
  beforeEach(() => {
    delete window.openforge
  })

  it('keeps persisted inline agent comment commands available to plugins', async () => {
    const { invoke } = installDesktopBridge([])

    await invokePluginHostCommand('getAgentReviewComments', { reviewPrId: '42' })
    expect(invoke).toHaveBeenLastCalledWith('get_agent_review_comments', { reviewPrId: 42 })

    await invokePluginHostCommand('updateAgentReviewCommentStatus', { commentId: '7', status: 'approved' })
    expect(invoke).toHaveBeenLastCalledWith('update_agent_review_comment_status', { commentId: 7, status: 'approved' })
  })

  it('does not expose removed live agent review start/abort host commands', async () => {
    const { invoke } = installDesktopBridge()

    await expect(invokePluginHostCommand('startAgentReview', { reviewPrId: 42 })).rejects.toThrow('Unknown plugin host command: startAgentReview')
    await expect(invokePluginHostCommand('abortAgentReview', { reviewSessionKey: 'review-42' })).rejects.toThrow('Unknown plugin host command: abortAgentReview')
    expect(invoke).not.toHaveBeenCalled()
  })
})
