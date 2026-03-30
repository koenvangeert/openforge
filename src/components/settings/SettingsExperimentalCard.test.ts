import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		codeCleanupTasksEnabled: false,
		onCodeCleanupTasksToggle: vi.fn(),
		...overrides,
	}
}

describe('SettingsExperimentalCard', () => {
	it('renders Experimental heading', () => {
		render(SettingsExperimentalCard, { props: defaultProps() })

		expect(screen.getByText('Experimental')).toBeTruthy()
	})

	describe('code cleanup tasks experiment toggle', () => {
		it('renders Code Cleanup Tasks label', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Code Cleanup Tasks')).toBeTruthy()
		})

		it('renders toggle unchecked when codeCleanupTasksEnabled is false', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ codeCleanupTasksEnabled: false }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when codeCleanupTasksEnabled is true', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ codeCleanupTasksEnabled: true }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(true)
		})

		it('calls onCodeCleanupTasksToggle when toggle is clicked', async () => {
			const onCodeCleanupTasksToggle = vi.fn()
			render(SettingsExperimentalCard, {
				props: defaultProps({ onCodeCleanupTasksToggle }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle')
			await fireEvent.click(toggle)

			expect(onCodeCleanupTasksToggle).toHaveBeenCalledOnce()
		})

		it('renders description text for code cleanup tasks toggle', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Agents create tasks for code that needs cleanup or splitting')).toBeTruthy()
		})
	})
})
