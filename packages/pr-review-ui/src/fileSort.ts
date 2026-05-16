import type { PrFileDiff } from '@openforge/plugin-sdk/domain'

interface SortNode {
  name: string
  isDir: boolean
  children: Map<string, SortNode>
  file?: PrFileDiff
}

/**
 * Sort files in tree order: directories first, then alphabetically at each level.
 * This matches the display order used by FileTree.svelte.
 */
export function sortFilesAsTree(files: PrFileDiff[]): PrFileDiff[] {
  if (files.length <= 1) return files

  // Build tree
  const root: SortNode = { name: '', isDir: true, children: new Map() }

  for (const file of files) {
    const parts = file.filename.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          isDir: !isLast,
          children: new Map(),
          file: isLast ? file : undefined,
        })
      }

      current = current.children.get(part)!
    }
  }

  // Flatten with same sort order as FileTree
  const result: PrFileDiff[] = []
  function flatten(node: SortNode) {
    const sortedChildren = [...node.children.values()].sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const child of sortedChildren) {
      if (child.file) {
        result.push(child.file)
      }
      if (child.isDir) {
        flatten(child)
      }
    }
  }
  flatten(root)

  return result
}
