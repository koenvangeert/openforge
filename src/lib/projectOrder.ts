import type { Project } from './types'

export function applyProjectOrder(projects: Project[], savedOrderJson: string | null): Project[] {
  if (!savedOrderJson) return projects

  try {
    const savedOrder: string[] = JSON.parse(savedOrderJson)
    if (!Array.isArray(savedOrder)) return projects

    const projectMap = new Map(projects.map(p => [p.id, p]))
    const orderedProjects: Project[] = []
    const seenIds = new Set<string>()

    // Add projects in saved order
    for (const id of savedOrder) {
      const project = projectMap.get(id)
      if (project && !seenIds.has(id)) {
        orderedProjects.push(project)
        seenIds.add(id)
      }
    }

    // Append new projects not in saved order
    for (const project of projects) {
      if (!seenIds.has(project.id)) {
        orderedProjects.push(project)
      }
    }

    return orderedProjects
  } catch (e) {
    console.error('Failed to parse project order', e)
    return projects
  }
}
