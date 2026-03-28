export const OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT = 1200

const OPEN_FORGE_CHUNK_GROUP_RULES = [
  {
    name: 'vendor-xterm',
    test: /node_modules\/@xterm\//,
  },
  {
    name: 'vendor-highlight',
    test: /node_modules\/(lowlight|highlight\.js|@git-diff-view\/lowlight)\//,
  },
  {
    name: 'vendor-diff',
    test: /node_modules\/@git-diff-view\//,
  },
  {
    name: 'vendor',
    test: /node_modules\//,
  },
] as const

export interface OpenForgeChunkGroup {
  name: string
  test: RegExp
}

export function getOpenForgeChunkGroupName(id: string): string | null {
  const normalizedId = id.replaceAll('\\', '/')

  for (const rule of OPEN_FORGE_CHUNK_GROUP_RULES) {
    if (rule.test.test(normalizedId)) {
      return rule.name
    }
  }

  return null
}

export function createOpenForgeChunkGroups(): OpenForgeChunkGroup[] {
  return OPEN_FORGE_CHUNK_GROUP_RULES.map((rule) => ({
    name: rule.name,
    test: rule.test,
  }))
}
