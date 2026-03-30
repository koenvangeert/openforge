import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsGeneralCard from './SettingsGeneralCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'Test Project',
    projectPath: '/tmp/test',
    aiProvider: 'claude-code',
    useWorktrees: true,
    disabled: false,
    opencodeInstalled: false,
    opencodeVersion: null,
    claudeInstalled: true,
    claudeVersion: '1.0.0',
    claudeAuthenticated: true,
    onProjectNameChange: vi.fn(),
    onProjectPathChange: vi.fn(),
    onAiProviderChange: vi.fn(),
    onUseWorktreesChange: vi.fn(),
    ...overrides,
  }
}

describe('SettingsGeneralCard', () => {
  it('renders General heading', () => {
    render(SettingsGeneralCard, { props: defaultProps() })

    expect(screen.getByText('General')).toBeTruthy()
  })

  describe('git worktrees toggle', () => {
    it('renders Git Worktrees label', () => {
      render(SettingsGeneralCard, { props: defaultProps() })

      expect(screen.getByText('Git Worktrees')).toBeTruthy()
    })

    it('renders toggle checked when useWorktrees is true', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ useWorktrees: true }),
      })

      const toggle = screen.getByTestId('use-worktrees-toggle') as HTMLInputElement
      expect(toggle.checked).toBe(true)
    })

    it('renders toggle unchecked when useWorktrees is false', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ useWorktrees: false }),
      })

      const toggle = screen.getByTestId('use-worktrees-toggle') as HTMLInputElement
      expect(toggle.checked).toBe(false)
    })

    it('calls onUseWorktreesChange when toggle is clicked', async () => {
      const onUseWorktreesChange = vi.fn()
      render(SettingsGeneralCard, {
        props: defaultProps({ onUseWorktreesChange }),
      })

      const toggle = screen.getByTestId('use-worktrees-toggle')
      await fireEvent.click(toggle)

      expect(onUseWorktreesChange).toHaveBeenCalledOnce()
    })

    it('renders description text for worktrees toggle', () => {
      render(SettingsGeneralCard, { props: defaultProps() })

      expect(
        screen.getByText(
          'Run agents in isolated git worktrees. When disabled, agents work directly in the project directory.'
        )
      ).toBeTruthy()
    })
  })
})
