import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

describe('SettingsPreferencesCard', () => {
	it('renders with current prefix value', () => {
		const onChange = vi.fn()
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: 'ABC',
				onTaskIdPrefixChange: onChange,
			},
		})

		const input = screen.getByDisplayValue('ABC') as HTMLInputElement
		expect(input).toBeTruthy()
		expect(input.value).toBe('ABC')
	})

	it('renders Preferences heading', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: '',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		expect(screen.getByText('Preferences')).toBeTruthy()
	})

	it('renders Task ID Prefix label', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: '',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		expect(screen.getByText('Task ID Prefix')).toBeTruthy()
	})

	it('shows preview when prefix is valid', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: 'ABC',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		expect(screen.getByText(/ABC-1/)).toBeTruthy()
		expect(screen.getByText(/ABC-2/)).toBeTruthy()
	})

	it('shows error message when prefix is invalid', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: '!!!',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		expect(screen.getByText(/Task ID prefix must be 1-5 alphanumeric characters/)).toBeTruthy()
	})

	it('does not show preview when prefix is empty', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: '',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		expect(screen.queryByText(/-1/)).toBeNull()
	})

	it('renders input with placeholder', () => {
		render(SettingsPreferencesCard, {
			props: {
				taskIdPrefix: '',
				onTaskIdPrefixChange: vi.fn(),
			},
		})

		const input = screen.getByPlaceholderText('e.g. ABC') as HTMLInputElement
		expect(input).toBeTruthy()
	})
})
