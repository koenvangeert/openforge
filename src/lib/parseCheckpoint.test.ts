import { describe, it, expect } from 'vitest'
import { requireDefined } from '../test-utils/dom'
import { parseCheckpointQuestion } from './parseCheckpoint'

describe('parseCheckpointQuestion', () => {
  it('returns null for null input', () => {
    expect(parseCheckpointQuestion(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCheckpointQuestion('')).toBeNull()
  })

  it('returns fallback for malformed JSON', () => {
    expect(parseCheckpointQuestion('not json')).toBe('Agent is waiting for input')
  })

  it('returns fallback for JSON with no known fields', () => {
    expect(parseCheckpointQuestion('{"unknown":"data"}')).toBe('Agent is waiting for input')
  })

  it('extracts properties.description', () => {
    const data = JSON.stringify({ properties: { description: 'Allow file write?' } })
    expect(parseCheckpointQuestion(data)).toBe('Allow file write?')
  })

  it('extracts properties.title when description is absent', () => {
    const data = JSON.stringify({ properties: { title: 'Permission needed' } })
    expect(parseCheckpointQuestion(data)).toBe('Permission needed')
  })

  it('extracts top-level message', () => {
    const data = JSON.stringify({ message: 'Approve this action?' })
    expect(parseCheckpointQuestion(data)).toBe('Approve this action?')
  })

  it('truncates strings longer than 500 characters', () => {
    const longText = 'A'.repeat(600)
    const data = JSON.stringify({ properties: { description: longText } })
    const result = parseCheckpointQuestion(data)
    const definedResult = requireDefined(result)

    expect(definedResult).toHaveLength(503)
    expect(definedResult.endsWith('...')).toBe(true)
  })

  it('prefers properties.description over properties.title', () => {
    const data = JSON.stringify({ properties: { description: 'desc', title: 'title' } })
    expect(parseCheckpointQuestion(data)).toBe('desc')
  })

  it('extracts question from question.asked event format', () => {
    const data = JSON.stringify({
      type: 'question.asked',
      properties: {
        id: 'que_abc123',
        sessionID: 'ses_xyz',
        questions: [
          {
            question: 'Run or Bike?',
            header: 'Run or Bike',
            options: [{ label: 'Run' }, { label: 'Bike' }]
          }
        ]
      }
    })
    expect(parseCheckpointQuestion(data)).toBe('Run or Bike?')
  })

  it('falls back to header when question field is absent in questions array', () => {
    const data = JSON.stringify({
      properties: {
        questions: [{ header: 'Choose action' }]
      }
    })
    expect(parseCheckpointQuestion(data)).toBe('Choose action')
  })

  it('prefers questions[0].question over properties.description', () => {
    const data = JSON.stringify({
      properties: {
        description: 'generic desc',
        questions: [{ question: 'specific question?' }]
      }
    })
    expect(parseCheckpointQuestion(data)).toBe('specific question?')
  })
})
