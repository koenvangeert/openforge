import { describe, expect, it } from 'vitest'

import {
  createOpenForgeChunkGroups,
  getOpenForgeChunkGroupName,
  OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT,
} from './viteChunks'

describe('getOpenForgeChunkGroupName', () => {
  it('matches xterm packages before the generic vendor bucket', () => {
    expect(getOpenForgeChunkGroupName('/repo/node_modules/@xterm/xterm/lib/xterm.js')).toBe('vendor-xterm')
    expect(getOpenForgeChunkGroupName('/repo/node_modules/@xterm/addon-webgl/lib/index.js')).toBe('vendor-xterm')
  })

  it('routes lowlight and highlight.js into the dedicated highlight chunk', () => {
    expect(getOpenForgeChunkGroupName('/repo/node_modules/highlight.js/lib/index.js')).toBe('vendor-highlight')
    expect(getOpenForgeChunkGroupName('/repo/node_modules/@git-diff-view/lowlight/dist/index.js')).toBe('vendor-highlight')
    expect(getOpenForgeChunkGroupName('/repo/node_modules/lowlight/lib/index.js')).toBe('vendor-highlight')
  })

  it('keeps other git diff view modules out of the highlight chunk', () => {
    expect(getOpenForgeChunkGroupName('/repo/node_modules/@git-diff-view/svelte/dist/index.js')).toBe('vendor-diff')
    expect(getOpenForgeChunkGroupName('/repo/node_modules/@git-diff-view/core/dist/index.js')).toBe('vendor-diff')
  })

  it('falls back to the coarse vendor chunk for other node_modules packages', () => {
    expect(getOpenForgeChunkGroupName('/repo/node_modules/lucide-svelte/dist/index.js')).toBe('vendor')
    expect(getOpenForgeChunkGroupName('/repo/node_modules/marked/lib/marked.esm.js')).toBe('vendor')
  })

  it('ignores application code outside node_modules', () => {
    expect(getOpenForgeChunkGroupName('/repo/src/components/App.svelte')).toBeNull()
  })

  it('normalizes windows-style paths before matching', () => {
    expect(getOpenForgeChunkGroupName('C:\\repo\\node_modules\\@xterm\\xterm\\lib\\xterm.js')).toBe('vendor-xterm')
  })
})

describe('createOpenForgeChunkGroups', () => {
  it('returns the ordered chunk groups used by the Vite build', () => {
    expect(createOpenForgeChunkGroups()).toEqual([
      { name: 'vendor-xterm', test: /node_modules\/@xterm\// },
      { name: 'vendor-highlight', test: /node_modules\/(lowlight|highlight\.js|@git-diff-view\/lowlight)\// },
      { name: 'vendor-diff', test: /node_modules\/@git-diff-view\// },
      { name: 'vendor', test: /node_modules\// },
    ])
  })

  it('exposes the raised chunk warning limit for known unavoidable chunks', () => {
    expect(OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT).toBe(1200)
  })
})
