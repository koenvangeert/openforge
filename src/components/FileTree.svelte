<script lang="ts">
  import type { PrFileDiff } from '../lib/types'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
  }

  let { files = [], onSelectFile }: Props = $props()

  let selectedFile = $state<string | null>(null)
  let expandedDirs = $state(new Set<string>())

  interface TreeNode {
    name: string
    fullPath: string
    isDir: boolean
    children: Map<string, TreeNode>
    file?: PrFileDiff
  }

  function collectDirPaths(files: PrFileDiff[]): Set<string> {
    const dirs = new Set<string>()
    for (const file of files) {
      const parts = file.filename.split('/')
      for (let i = 0; i < parts.length - 1; i++) {
        dirs.add(parts.slice(0, i + 1).join('/'))
      }
    }
    return dirs
  }

  $effect(() => {
    expandedDirs = collectDirPaths(files)
  })

  let tree = $derived(buildTree(files))
  let totalStats = $derived(files.reduce((acc, f) => ({
    additions: acc.additions + f.additions,
    deletions: acc.deletions + f.deletions,
  }), { additions: 0, deletions: 0 }))

  function buildTree(files: PrFileDiff[]): TreeNode {
    const root: TreeNode = { name: '', fullPath: '', isDir: true, children: new Map() }

    for (const file of files) {
      const parts = file.filename.split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isLast = i === parts.length - 1
        const fullPath = parts.slice(0, i + 1).join('/')

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullPath,
            isDir: !isLast,
            children: new Map(),
            file: isLast ? file : undefined,
          })
        }

        current = current.children.get(part)!
      }
    }

    return root
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'added': return '+'
      case 'removed': return '−'
      case 'modified': return '±'
      case 'renamed': return '→'
      default: return '•'
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--error)'
      case 'modified': return 'var(--warning)'
      case 'renamed': return 'var(--accent)'
      default: return 'var(--text-secondary)'
    }
  }

  function handleFileClick(file: PrFileDiff) {
    selectedFile = file.filename
    onSelectFile(file.filename)
  }

  function toggleDir(path: string) {
    const next = new Set(expandedDirs)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    expandedDirs = next
  }

  function flattenTree(node: TreeNode, depth: number = 0, _dirs?: Set<string>): Array<{ node: TreeNode; depth: number }> {
    const result: Array<{ node: TreeNode; depth: number }> = []
    const sortedChildren = [...node.children.entries()].sort(([, a], [, b]) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const [, child] of sortedChildren) {
      result.push({ node: child, depth })
      if (child.isDir && expandedDirs.has(child.fullPath)) {
        result.push(...flattenTree(child, depth + 1))
      }
    }
    return result
  }

  let flattenedNodes = $derived(flattenTree(tree, 0, expandedDirs))
</script>

<div class="file-tree">
  <div class="header">
    <div class="stats">
      <span class="count">{files.length} files</span>
      <span class="additions">+{totalStats.additions}</span>
      <span class="deletions">−{totalStats.deletions}</span>
    </div>
  </div>

  <div class="tree-container">
    {#each flattenedNodes as { node, depth }}
      {#if node.isDir}
        <button class="dir-toggle" style="padding-left: {12 + depth * 16}px" onclick={() => toggleDir(node.fullPath)}>
          <span class="icon">{expandedDirs.has(node.fullPath) ? '▼' : '▶'}</span>
          <span class="name">{node.name}/</span>
        </button>
      {:else if node.file}
        <button 
          class="tree-node file" 
          class:selected={selectedFile === node.file.filename}
          style="padding-left: {12 + depth * 16}px"
          onclick={() => node.file && handleFileClick(node.file)}
        >
          <span class="status-icon" style="color: {getStatusColor(node.file.status)}">
            {getStatusIcon(node.file.status)}
          </span>
          <span class="name">{node.name}</span>
          <span class="file-stats">
            <span class="additions">+{node.file.additions}</span>
            <span class="deletions">−{node.file.deletions}</span>
          </span>
        </button>
      {/if}
    {/each}
  </div>
</div>

<style>
  .file-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
  }

  .header {
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }

  .stats {
    display: flex;
    gap: 12px;
    font-size: 0.75rem;
  }

  .count {
    color: var(--text-primary);
    font-weight: 500;
  }

  .additions {
    color: var(--success);
  }

  .deletions {
    color: var(--error);
  }

  .tree-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .tree-node {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 0.8rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.1s;
  }

  .tree-node:hover {
    background: rgba(122, 162, 247, 0.1);
  }

  .tree-node.selected {
    background: rgba(122, 162, 247, 0.2);
    border-left: 2px solid var(--accent);
  }

  .dir-toggle {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 0.8rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.1s;
    width: 100%;
  }

  .dir-toggle:hover {
    background: rgba(122, 162, 247, 0.1);
  }

  .dir-toggle .icon {
    font-size: 0.6rem;
    color: var(--text-secondary);
  }

  .dir-toggle .name {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .status-icon {
    font-weight: bold;
    font-size: 0.9rem;
    width: 16px;
    text-align: center;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-stats {
    display: flex;
    gap: 8px;
    font-size: 0.7rem;
    margin-left: auto;
  }
</style>
