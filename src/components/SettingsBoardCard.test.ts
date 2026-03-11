import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BoardColumnConfig } from '../lib/types'

vi.mock('../lib/boardColumns', () => ({
	DEFAULT_BOARD_COLUMNS: [
		{ id: 'col-backlog', name: 'Backlog', statuses: ['egg'], underlyingStatus: 'backlog' },
		{ id: 'col-doing', name: 'Doing', statuses: ['idle', 'active'], underlyingStatus: 'doing' },
	],
	ALL_CREATURE_STATES: ['egg', 'idle', 'active', 'done'],
	CREATURE_STATE_LABELS: { egg: 'Egg', idle: 'Idle', active: 'Active', done: 'Done' },
	validateBoardColumns: vi.fn(() => ({ valid: true, errors: [] })),
}))

import SettingsBoardCard from './SettingsBoardCard.svelte'
import { DEFAULT_BOARD_COLUMNS } from '../lib/boardColumns'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		columns: [...(DEFAULT_BOARD_COLUMNS as BoardColumnConfig[])],
		onColumnsChange: vi.fn(),
		disabled: false,
		...overrides,
	}
}

describe('SettingsBoardCard', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('renders with Board Columns header', () => {
		render(SettingsBoardCard, { props: defaultProps() })
		expect(screen.getByText('Board Columns')).toBeTruthy()
	})

	it('renders default columns', () => {
		render(SettingsBoardCard, { props: defaultProps() })
		expect(screen.getAllByDisplayValue('Backlog').length).toBeGreaterThan(0)
		expect(screen.getAllByDisplayValue('Doing').length).toBeGreaterThan(0)
	})

	it('add column calls onColumnsChange with new column', async () => {
		const onColumnsChange = vi.fn()
		render(SettingsBoardCard, { props: defaultProps({ onColumnsChange }) })

		const addButton = screen.getByRole('button', { name: /add column/i })
		await fireEvent.click(addButton)

		expect(onColumnsChange).toHaveBeenCalledOnce()
		const newColumns: BoardColumnConfig[] = onColumnsChange.mock.calls[0][0]
		expect(newColumns).toHaveLength((DEFAULT_BOARD_COLUMNS as BoardColumnConfig[]).length + 1)
		const added = newColumns[newColumns.length - 1]
		expect(added).toMatchObject({
			name: '',
			statuses: [],
			underlyingStatus: 'backlog',
		})
		expect(typeof added.id).toBe('string')
		expect(added.id.length).toBeGreaterThan(0)
	})

	it('remove column calls onColumnsChange without removed column', async () => {
		const onColumnsChange = vi.fn()
		render(SettingsBoardCard, { props: defaultProps({ onColumnsChange }) })

		const removeButtons = screen.getAllByTitle('Remove column')
		await fireEvent.click(removeButtons[0])

		expect(onColumnsChange).toHaveBeenCalledOnce()
		const newColumns: BoardColumnConfig[] = onColumnsChange.mock.calls[0][0]
		expect(newColumns).toHaveLength((DEFAULT_BOARD_COLUMNS as BoardColumnConfig[]).length - 1)
		expect(newColumns.find((c) => c.id === 'col-backlog')).toBeUndefined()
	})

	it('reset to default calls onColumnsChange with DEFAULT_BOARD_COLUMNS', async () => {
		const onColumnsChange = vi.fn()
		render(SettingsBoardCard, { props: defaultProps({ onColumnsChange }) })

		const resetButton = screen.getByRole('button', { name: /reset to default/i })
		await fireEvent.click(resetButton)

		expect(onColumnsChange).toHaveBeenCalledWith(DEFAULT_BOARD_COLUMNS)
	})

	it('changing column name calls onColumnsChange with updated name', async () => {
		const onColumnsChange = vi.fn()
		render(SettingsBoardCard, { props: defaultProps({ onColumnsChange }) })
		const nameInputs = screen.getAllByPlaceholderText('Column name')
		await fireEvent.input(nameInputs[0], { target: { value: 'Todo' } })
		expect(onColumnsChange).toHaveBeenCalledOnce()
		const newColumns: BoardColumnConfig[] = onColumnsChange.mock.calls[0][0]
		expect(newColumns[0].name).toBe('Todo')
	})

	it('toggling creature state checkbox calls onColumnsChange with updated statuses', async () => {
		const onColumnsChange = vi.fn()
		render(SettingsBoardCard, { props: defaultProps({ onColumnsChange }) })
		// Find the 'Idle' checkbox label and click it
		const idleCheckbox = screen.getAllByLabelText('Idle')[0]
		await fireEvent.click(idleCheckbox)
		expect(onColumnsChange).toHaveBeenCalledOnce()
		const newColumns: BoardColumnConfig[] = onColumnsChange.mock.calls[0][0]
		expect(newColumns[0].statuses).toContain('idle')
	})

	it('displays validation errors when config is invalid', async () => {
		const { validateBoardColumns } = await import('../lib/boardColumns')
		vi.mocked(validateBoardColumns).mockReturnValue({ valid: false, errors: ['Creature state "done" is missing from all columns.'] })
		render(SettingsBoardCard, { props: defaultProps() })
		expect(screen.getByText('Creature state "done" is missing from all columns.')).toBeTruthy()
	})
})
