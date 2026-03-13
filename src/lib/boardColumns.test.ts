import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardColumnConfig } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

import {
  ALL_TASK_STATES,
  BACKLOG_COLUMN,
  DONE_COLUMN,
  TASK_STATE_LABELS,
  DEFAULT_BOARD_COLUMNS,
  getColumnForTaskState,
  loadBoardColumns,
  saveBoardColumns,
  validateBoardColumns,
} from '../lib/boardColumns'
import { getProjectConfig, setProjectConfig } from '../lib/ipc'

describe('boardColumns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constants', () => {
    it('defines all 15 task states', () => {
      expect(ALL_TASK_STATES).toHaveLength(15)
      expect(ALL_TASK_STATES).toEqual([
        'idle',
        'active',
        'needs-input',
        'resting',
        'celebrating',
        'sad',
        'frozen',
        'pr-draft',
        'pr-open',
        'ci-running',
        'review-pending',
        'ci-failed',
        'changes-requested',
        'ready-to-merge',
        'pr-merged',
      ])
    })

    it('exports fixed backlog column constant', () => {
      expect(BACKLOG_COLUMN).toEqual({
        id: 'col-backlog',
        name: 'Backlog',
        statuses: ['egg'],
        underlyingStatus: 'backlog',
      })
    })

    it('exports fixed done column constant', () => {
      expect(DONE_COLUMN).toEqual({
        id: 'col-done',
        name: 'Done',
        statuses: ['done'],
        underlyingStatus: 'done',
      })
    })

    it('maps task state labels to human readable names', () => {
      expect(TASK_STATE_LABELS['egg']).toBe('New')
      expect(TASK_STATE_LABELS['needs-input']).toBe('Needs Input')
      expect(TASK_STATE_LABELS['pr-draft']).toBe('PR Draft')
      expect(TASK_STATE_LABELS['ci-running']).toBe('CI Running')
      expect(TASK_STATE_LABELS['review-pending']).toBe('Awaiting Review')
      expect(TASK_STATE_LABELS['ci-failed']).toBe('CI Failed')
      expect(TASK_STATE_LABELS['ready-to-merge']).toBe('Ready to Merge')
    })

    it('defines default columns matching current behavior', () => {
      expect(DEFAULT_BOARD_COLUMNS).toHaveLength(1)
      expect(DEFAULT_BOARD_COLUMNS).toEqual([
        {
          id: 'col-doing',
          name: 'Doing',
          statuses: [
            'idle',
            'active',
            'needs-input',
            'resting',
            'celebrating',
            'sad',
            'frozen',
            'pr-draft',
            'pr-open',
            'ci-running',
            'review-pending',
            'ci-failed',
            'changes-requested',
            'ready-to-merge',
            'pr-merged',
          ],
          underlyingStatus: 'doing',
        },
      ])
    })
  })

  describe('validateBoardColumns', () => {
    it('returns valid for defaults', () => {
      expect(validateBoardColumns(DEFAULT_BOARD_COLUMNS)).toEqual({
        valid: true,
        errors: [],
      })
    })

    it('requires at least one column', () => {
      const result = validateBoardColumns([])
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('fails when a state is missing', () => {
      const withoutIdle: BoardColumnConfig[] = DEFAULT_BOARD_COLUMNS.map((column) => {
        if (column.id !== 'col-doing') return column
        return { ...column, statuses: column.statuses.filter((s) => s !== 'idle') }
      })

      const result = validateBoardColumns(withoutIdle)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('idle'))).toBe(true)
    })

    it('fails when a state appears in multiple columns', () => {
      const withDuplicate: BoardColumnConfig[] = [
        DEFAULT_BOARD_COLUMNS[0],
        {
          id: 'col-doing-2',
          name: 'Doing 2',
          statuses: ['idle'],
          underlyingStatus: 'doing',
        },
      ]

      const result = validateBoardColumns(withDuplicate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('idle'))).toBe(true)
    })

    it('fails when a column name is empty', () => {
      const invalidColumns: BoardColumnConfig[] = [
        { ...DEFAULT_BOARD_COLUMNS[0], name: ' ' },
      ]

      const result = validateBoardColumns(invalidColumns)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('name'))).toBe(true)
    })
  })

  describe('getColumnForTaskState', () => {
    it('returns matching column for task state', () => {
      const column = getColumnForTaskState('pr-open', DEFAULT_BOARD_COLUMNS)
      expect(column.id).toBe('col-doing')
    })

    it('falls back to first column when state not found', () => {
      const customColumns: BoardColumnConfig[] = [
        {
          id: 'first',
          name: 'First',
          statuses: ['idle'],
          underlyingStatus: 'doing',
        },
      ]

      const column = getColumnForTaskState('active', customColumns)
      expect(column.id).toBe('first')
    })
  })

  describe('loadBoardColumns', () => {
    it('returns defaults and seeds config when missing', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('returns stored config when valid', async () => {
      const customColumns: BoardColumnConfig[] = [
        {
          id: 'col-doing',
          name: 'In Progress',
          statuses: [
            'idle',
            'active',
            'needs-input',
            'resting',
            'celebrating',
            'sad',
            'frozen',
            'pr-draft',
            'pr-open',
            'ci-running',
            'review-pending',
            'ci-failed',
            'changes-requested',
            'ready-to-merge',
            'pr-merged',
          ],
          underlyingStatus: 'doing',
        },
      ]

      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(customColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(customColumns)
      expect(setProjectConfig).not.toHaveBeenCalled()
    })

    it('falls back to defaults when JSON is malformed', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue('{bad json')

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('falls back to defaults when stored config is invalid (no doing column)', async () => {
      const invalidColumns = [
        {
          id: 'col-other',
          name: 'Other',
          statuses: ['idle'],
          underlyingStatus: 'other',
        },
      ]
      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(invalidColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('migrates old config with 13 states to 15 states', async () => {
      const oldColumns: BoardColumnConfig[] = [
        {
          id: 'col-doing',
          name: 'Doing',
          statuses: [
            'idle',
            'active',
            'needs-input',
            'resting',
            'celebrating',
            'sad',
            'frozen',
            'pr-draft',
            'pr-open',
            'ci-failed',
            'changes-requested',
            'ready-to-merge',
            'pr-merged',
          ],
          underlyingStatus: 'doing',
        },
      ]

      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(oldColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toHaveLength(1)
      expect(result[0].statuses).toHaveLength(15)
      expect(result[0].statuses).toContain('ci-running')
      expect(result[0].statuses).toContain('review-pending')
      expect(result[0].name).toBe('Doing')
      expect(setProjectConfig).not.toHaveBeenCalled()
    })

    it('returns config unchanged when already migrated', async () => {
      const migratedColumns: BoardColumnConfig[] = [
        {
          id: 'col-doing',
          name: 'Doing',
          statuses: [
            'idle',
            'active',
            'needs-input',
            'resting',
            'celebrating',
            'sad',
            'frozen',
            'pr-draft',
            'pr-open',
            'ci-running',
            'review-pending',
            'ci-failed',
            'changes-requested',
            'ready-to-merge',
            'pr-merged',
          ],
          underlyingStatus: 'doing',
        },
      ]

      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(migratedColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(migratedColumns)
      expect(setProjectConfig).not.toHaveBeenCalled()
    })
  })

  describe('saveBoardColumns', () => {
    it('serializes valid columns to project_config unchanged', async () => {
      await saveBoardColumns('project-1', DEFAULT_BOARD_COLUMNS)

      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('normalizes repairable configs before persisting them', async () => {
      const oldColumns: BoardColumnConfig[] = [
        {
          id: 'col-doing',
          name: 'Doing',
          statuses: [
            'idle',
            'active',
            'needs-input',
            'resting',
            'celebrating',
            'sad',
            'frozen',
            'pr-draft',
            'pr-open',
            'ci-failed',
            'changes-requested',
            'ready-to-merge',
            'pr-merged',
          ],
          underlyingStatus: 'doing',
        },
      ]
      const normalizedColumns: BoardColumnConfig[] = [
        {
          ...oldColumns[0],
          statuses: [...oldColumns[0].statuses, 'ci-running', 'review-pending'],
        },
      ]

      await saveBoardColumns('project-1', oldColumns)

      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(normalizedColumns),
      )
    })

    it('rejects still-invalid configs instead of persisting them', async () => {
      const invalidColumns: BoardColumnConfig[] = [
        DEFAULT_BOARD_COLUMNS[0],
        {
          id: 'col-doing-2',
          name: 'Doing 2',
          statuses: ['idle'],
          underlyingStatus: 'doing',
        },
      ]

      await expect(saveBoardColumns('project-1', invalidColumns)).rejects.toThrow(
        'Task state "idle" appears in multiple columns.',
      )
      expect(setProjectConfig).not.toHaveBeenCalled()
    })
  })
})
