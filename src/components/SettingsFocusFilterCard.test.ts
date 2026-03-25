import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/boardColumns', () => ({
	ALL_TASK_STATES: ['idle', 'active', 'needs-input', 'ci-failed', 'changes-requested', 'failed'],
	TASK_STATE_LABELS: {
		idle: 'Idle',
		active: 'Running',
		'needs-input': 'Needs Input',
		'ci-failed': 'CI Failed',
		'changes-requested': 'Changes Requested',
		failed: 'Failed',
	},
}))

vi.mock('../lib/boardFilters', () => ({
	DEFAULT_FOCUS_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
}))

import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
import { DEFAULT_FOCUS_STATES } from '../lib/boardFilters'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		focusStates: [...(DEFAULT_FOCUS_STATES as string[])],
		onFocusStatesChange: vi.fn(),
		disabled: false,
		...overrides,
	}
}

describe('SettingsFocusFilterCard', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('renders with Focus Filter States header', () => {
		render(SettingsFocusFilterCard, { props: defaultProps() })
		expect(screen.getByText('Focus Filter States')).toBeTruthy()
	})

	it('renders checkboxes for task states', () => {
		render(SettingsFocusFilterCard, { props: defaultProps() })
		expect(screen.getByLabelText('Idle')).toBeTruthy()
		expect(screen.getByLabelText('Needs Input')).toBeTruthy()
		expect(screen.getByLabelText('CI Failed')).toBeTruthy()
	})

	it('checked states match focusStates prop', () => {
		render(SettingsFocusFilterCard, { props: defaultProps({ focusStates: ['needs-input', 'ci-failed'] }) })
		const needsInputBox = screen.getByLabelText('Needs Input') as HTMLInputElement
		const ciFailedBox = screen.getByLabelText('CI Failed') as HTMLInputElement
		const idleBox = screen.getByLabelText('Idle') as HTMLInputElement
		expect(needsInputBox.checked).toBe(true)
		expect(ciFailedBox.checked).toBe(true)
		expect(idleBox.checked).toBe(false)
	})

	it('toggling unchecked checkbox calls onFocusStatesChange with state added', async () => {
		const onFocusStatesChange = vi.fn()
		render(SettingsFocusFilterCard, {
			props: defaultProps({ focusStates: ['needs-input'], onFocusStatesChange }),
		})
		const idleBox = screen.getByLabelText('Idle')
		await fireEvent.click(idleBox)
		expect(onFocusStatesChange).toHaveBeenCalledOnce()
		const result: string[] = onFocusStatesChange.mock.calls[0][0]
		expect(result).toContain('idle')
		expect(result).toContain('needs-input')
	})

	it('toggling checked checkbox calls onFocusStatesChange with state removed', async () => {
		const onFocusStatesChange = vi.fn()
		render(SettingsFocusFilterCard, {
			props: defaultProps({ focusStates: ['needs-input', 'ci-failed'], onFocusStatesChange }),
		})
		const needsInputBox = screen.getByLabelText('Needs Input')
		await fireEvent.click(needsInputBox)
		expect(onFocusStatesChange).toHaveBeenCalledOnce()
		const result: string[] = onFocusStatesChange.mock.calls[0][0]
		expect(result).not.toContain('needs-input')
		expect(result).toContain('ci-failed')
	})

	it('Reset to Default button calls onFocusStatesChange with DEFAULT_FOCUS_STATES', async () => {
		const onFocusStatesChange = vi.fn()
		render(SettingsFocusFilterCard, { props: defaultProps({ onFocusStatesChange }) })
		const resetButton = screen.getByRole('button', { name: /reset to default/i })
		await fireEvent.click(resetButton)
		expect(onFocusStatesChange).toHaveBeenCalledWith(DEFAULT_FOCUS_STATES)
	})
})
