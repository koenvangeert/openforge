import { describe, it, expect } from 'vitest'
import { applyProjectOrder } from './projectOrder'
import type { Project } from './types'

describe('applyProjectOrder', () => {
  const projects: Project[] = [
    { id: '1', name: 'Project A', path: '/tmp/project-a', created_at: 0, updated_at: 0 },
    { id: '2', name: 'Project B', path: '/tmp/project-b', created_at: 0, updated_at: 0 },
    { id: '3', name: 'Project C', path: '/tmp/project-c', created_at: 0, updated_at: 0 },
  ]

  it('returns original array if no saved order', () => {
    expect(applyProjectOrder(projects, null)).toEqual(projects)
  })

  it('orders projects according to saved order', () => {
    const savedOrder = JSON.stringify(['3', '1', '2'])
    const result = applyProjectOrder(projects, savedOrder)
    expect(result.map(p => p.id)).toEqual(['3', '1', '2'])
  })

  it('appends projects not in saved order to the end', () => {
    const savedOrder = JSON.stringify(['2', '3'])
    const result = applyProjectOrder(projects, savedOrder)
    expect(result.map(p => p.id)).toEqual(['2', '3', '1'])
  })

  it('ignores invalid IDs in saved order', () => {
    const savedOrder = JSON.stringify(['3', '999', '1'])
    const result = applyProjectOrder(projects, savedOrder)
    expect(result.map(p => p.id)).toEqual(['3', '1', '2'])
  })

  it('deduplicates repeated IDs in saved order', () => {
    const savedOrder = JSON.stringify(['2', '2', '1'])
    const result = applyProjectOrder(projects, savedOrder)
    expect(result.map((project) => project.id)).toEqual(['2', '1', '3'])
  })

  it('handles invalid JSON gracefully', () => {
    const result = applyProjectOrder(projects, '{ invalid json }')
    expect(result).toEqual(projects)
  })
})
