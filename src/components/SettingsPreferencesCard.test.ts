import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		taskIdPrefix: '',
		onTaskIdPrefixChange: vi.fn(),
		isDarkMode: false,
		onThemeToggle: vi.fn(),
		creaturesEnabled: false,
		onCreaturesToggle: vi.fn(),
		codeCleanupTasksEnabled: false,
		onCodeCleanupTasksToggle: vi.fn(),
		...overrides,
	}
}

describe('SettingsPreferencesCard', () => {
	it('renders with current prefix value', () => {
		render(SettingsPreferencesCard, {
			props: defaultProps({ taskIdPrefix: 'ABC' }),
		})

		const input = screen.getByDisplayValue('ABC') as HTMLInputElement
		expect(input).toBeTruthy()
		expect(input.value).toBe('ABC')
	})

	it('renders Preferences heading', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		expect(screen.getByText('Preferences')).toBeTruthy()
	})

	it('renders Task ID Prefix label', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		expect(screen.getByText('Task ID Prefix')).toBeTruthy()
	})

	it('shows preview when prefix is valid', () => {
		render(SettingsPreferencesCard, {
			props: defaultProps({ taskIdPrefix: 'ABC' }),
		})

		expect(screen.getByText(/ABC-1/)).toBeTruthy()
		expect(screen.getByText(/ABC-2/)).toBeTruthy()
	})

	it('shows error message when prefix is invalid', () => {
		render(SettingsPreferencesCard, {
			props: defaultProps({ taskIdPrefix: '!!!' }),
		})

		expect(screen.getByText(/Task ID prefix must be 1-5 alphanumeric characters/)).toBeTruthy()
	})

	it('does not show preview when prefix is empty', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		expect(screen.queryByText(/-1/)).toBeNull()
	})

	it('renders input with placeholder', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		const input = screen.getByPlaceholderText('e.g. ABC') as HTMLInputElement
		expect(input).toBeTruthy()
	})

	describe('dark mode toggle', () => {
		it('renders Dark Mode label', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Dark Mode')).toBeTruthy()
		})

		it('renders toggle unchecked when isDarkMode is false', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ isDarkMode: false }),
			})

			const toggle = screen.getByTestId('theme-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when isDarkMode is true', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ isDarkMode: true }),
			})

			const toggle = screen.getByTestId('theme-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(true)
		})

		it('calls onThemeToggle when toggle is clicked', async () => {
			const onThemeToggle = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onThemeToggle }),
			})

			const toggle = screen.getByTestId('theme-toggle')
			await fireEvent.click(toggle)

			expect(onThemeToggle).toHaveBeenCalledOnce()
		})

		it('renders description text', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Switch between light and dark theme')).toBeTruthy()
		})
	})

	describe('code cleanup tasks experiment toggle', () => {
		it('renders Code Cleanup Tasks label', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Code Cleanup Tasks')).toBeTruthy()
		})

		it('renders toggle unchecked when codeCleanupTasksEnabled is false', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ codeCleanupTasksEnabled: false }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when codeCleanupTasksEnabled is true', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ codeCleanupTasksEnabled: true }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(true)
		})

		it('calls onCodeCleanupTasksToggle when toggle is clicked', async () => {
			const onCodeCleanupTasksToggle = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onCodeCleanupTasksToggle }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle')
			await fireEvent.click(toggle)

			expect(onCodeCleanupTasksToggle).toHaveBeenCalledOnce()
		})

		it('renders description text for code cleanup tasks toggle', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Agents create tasks for code that needs cleanup or splitting')).toBeTruthy()
		})
	})

	describe('creatures experiment toggle', () => {
		it('renders Creatures Experiment label', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Creatures Experiment')).toBeTruthy()
		})

		it('renders toggle unchecked when creaturesEnabled is false', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ creaturesEnabled: false }),
			})

			const toggle = screen.getByTestId('creatures-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when creaturesEnabled is true', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ creaturesEnabled: true }),
			})

			const toggle = screen.getByTestId('creatures-toggle') as HTMLInputElement
			expect(toggle.checked).toBe(true)
		})

		it('calls onCreaturesToggle when toggle is clicked', async () => {
			const onCreaturesToggle = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onCreaturesToggle }),
			})

			const toggle = screen.getByTestId('creatures-toggle')
			await fireEvent.click(toggle)

			expect(onCreaturesToggle).toHaveBeenCalledOnce()
		})

		it('renders description text for creatures toggle', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Show the Creatures view in the sidebar')).toBeTruthy()
		})
	})
})
