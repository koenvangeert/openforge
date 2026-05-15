import { describe, expect, it } from 'vitest'
import { validateSchemaValue } from './commandValidation'

describe('plugin runtime command validation', () => {
  it('accepts omitted schemas and unknown lightweight schema types', () => {
    expect(() => validateSchemaValue(undefined, { any: 'thing' }, 'command input')).not.toThrow()
    expect(() => validateSchemaValue({ type: 'custom' }, Symbol('value'), 'command input')).not.toThrow()
  })

  it('validates primitive JSON Schema types used by runtime command contracts', () => {
    expect(() => validateSchemaValue({ type: 'string' }, 'ok', 'command input')).not.toThrow()
    expect(() => validateSchemaValue({ type: 'number' }, 1.5, 'command input')).not.toThrow()
    expect(() => validateSchemaValue({ type: 'integer' }, 2, 'command input')).not.toThrow()
    expect(() => validateSchemaValue({ type: 'boolean' }, false, 'command input')).not.toThrow()
    expect(() => validateSchemaValue({ type: 'null' }, null, 'command input')).not.toThrow()

    expect(() => validateSchemaValue({ type: 'number' }, Number.NaN, 'command input')).toThrow('command input expected number')
    expect(() => validateSchemaValue({ type: 'number' }, Number.POSITIVE_INFINITY, 'command input')).toThrow('command input expected number')
    expect(() => validateSchemaValue({ type: 'integer' }, 2.5, 'command input')).toThrow('command input expected integer')
  })

  it('validates required object properties and nested property schemas with path labels', () => {
    const schema = {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        options: {
          type: 'object',
          properties: { dryRun: { type: 'boolean' } },
        },
      },
    }

    expect(() => validateSchemaValue(schema, { projectId: 'P-1', options: { dryRun: true } }, 'github.sync input')).not.toThrow()
    expect(() => validateSchemaValue(schema, {}, 'github.sync input')).toThrow('github.sync input missing required property projectId')
    expect(() => validateSchemaValue(schema, { projectId: 'P-1', options: { dryRun: 'yes' } }, 'github.sync input')).toThrow('github.sync input.options.dryRun expected boolean')
  })

  it('validates array items with indexed path labels', () => {
    const schema = { type: 'array', items: { type: 'integer' } }

    expect(() => validateSchemaValue(schema, [1, 2, 3], 'github.batch input')).not.toThrow()
    expect(() => validateSchemaValue(schema, [1, '2'], 'github.batch input')).toThrow('github.batch input[1] expected integer')
  })

  it('accepts values matching oneOf or anyOf candidates and reports all candidate failures', () => {
    const schema = { oneOf: [{ type: 'string' }, { type: 'integer' }] }
    const anyOfSchema = { anyOf: [{ type: 'boolean' }, { type: 'null' }] }

    expect(() => validateSchemaValue(schema, 'sync', 'command input')).not.toThrow()
    expect(() => validateSchemaValue(schema, 3, 'command input')).not.toThrow()
    expect(() => validateSchemaValue(anyOfSchema, null, 'command input')).not.toThrow()
    expect(() => validateSchemaValue(schema, false, 'command input')).toThrow('command input does not match any allowed schema: command input expected string; command input expected integer')
  })
})
