import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		taskIdPrefix: '',
		onTaskIdPrefixChange: vi.fn(),
		isDarkMode: false,
		onThemeToggle: vi.fn(),
		githubPollInterval: 30,
		onGithubPollIntervalChange: vi.fn(),
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

	describe('GitHub Poll Interval', () => {
		it('renders "GitHub Poll Interval" label', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('GitHub Poll Interval')).toBeTruthy()
		})

		it('renders number input with current value', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ githubPollInterval: 60 }),
			})

			const input = screen.getByTestId('poll-interval-input') as HTMLInputElement
			expect(input).toBeTruthy()
			expect(input.value).toBe('60')
		})

		it('input has min=30 and max=300 attributes', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			const input = screen.getByTestId('poll-interval-input') as HTMLInputElement
			expect(input.min).toBe('30')
			expect(input.max).toBe('300')
		})

		it('calls onGithubPollIntervalChange when value changes', async () => {
			const onGithubPollIntervalChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onGithubPollIntervalChange }),
			})

			const input = screen.getByTestId('poll-interval-input') as HTMLInputElement
			await fireEvent.input(input, { target: { value: '90' } })

			expect(onGithubPollIntervalChange).toHaveBeenCalled()
		})

		it('shows helper text with current interval', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ githubPollInterval: 45 }),
			})

			expect(screen.getByText('Polls every 45 seconds')).toBeTruthy()
		})
	})

})
