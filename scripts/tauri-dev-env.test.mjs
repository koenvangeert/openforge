import { describe, expect, it } from 'vitest'
import path from 'node:path'

import {
  DEFAULT_DEV_BACKEND_PORT,
  buildTauriDevEnv,
  computeCargoTargetDir,
  resolveGitCommonDir,
  sharedCargoTargetDirFromGitCommonDir,
} from './tauri-dev-env.mjs'

describe('tauri dev shared Cargo target env', () => {
  it('resolves relative git common dirs from the current worktree', () => {
    expect(resolveGitCommonDir('/repo/worktrees/KVG-820', '../../main/.git')).toBe(
      path.resolve('/repo/worktrees/KVG-820', '../../main/.git'),
    )
  })

  it('places shared target beside a non-bare .git directory', () => {
    expect(sharedCargoTargetDirFromGitCommonDir('/repo/main/.git')).toBe(
      path.join('/repo/main', '.cargo-target'),
    )
  })

  it('places shared target inside a non-standard common git directory', () => {
    expect(sharedCargoTargetDirFromGitCommonDir('/repo/main/git-common')).toBe(
      path.join('/repo/main/git-common', 'openforge-cargo-target'),
    )
  })

  it('keeps an explicit CARGO_TARGET_DIR unchanged', () => {
    const result = computeCargoTargetDir({
      cwd: '/repo/worktree',
      env: { CARGO_TARGET_DIR: '/custom/target' },
      execFileSync: () => {
        throw new Error('git should not be consulted')
      },
    })

    expect(result).toEqual({ cargoTargetDir: '/custom/target', source: 'env' })
  })

  it('uses the git common dir to share Rust artifacts across worktrees', () => {
    const result = computeCargoTargetDir({
      cwd: '/repo/worktrees/KVG-820',
      env: {},
      execFileSync: () => '../main/.git\n',
    })

    expect(result).toEqual({
      cargoTargetDir: path.resolve('/repo/worktrees/KVG-820', '../main/.cargo-target'),
      source: 'git-common-dir',
    })
  })

  it('falls back to the existing src-tauri target dir outside git', () => {
    const result = computeCargoTargetDir({
      cwd: '/repo/openforge',
      env: {},
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result).toEqual({
      cargoTargetDir: path.join('/repo/openforge', 'src-tauri', 'target'),
      source: 'fallback',
    })
  })

  it('returns an environment object with CARGO_TARGET_DIR and dev backend ports set', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/worktrees/KVG-820',
      env: { PATH: '/bin' },
      execFileSync: () => '../main/.git\n',
    })

    expect(result.env).toMatchObject({
      PATH: '/bin',
      CARGO_TARGET_DIR: path.resolve('/repo/worktrees/KVG-820', '../main/.cargo-target'),
      OPENFORGE_BACKEND_PORT: String(DEFAULT_DEV_BACKEND_PORT),
      OPENFORGE_HTTP_PORT: String(DEFAULT_DEV_BACKEND_PORT),
    })
    expect(result.source).toBe('git-common-dir')
  })

  it('uses an explicit dev backend port for both backend binding and hook clients when the hook port is not explicit', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/openforge',
      env: { OPENFORGE_BACKEND_PORT: '18000' },
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('18000')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('18000')
  })

  it('uses a non-production dev backend port when the legacy production port is inherited', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/openforge',
      env: { AI_COMMAND_CENTER_PORT: '17422' },
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe(String(DEFAULT_DEV_BACKEND_PORT))
    expect(result.env.OPENFORGE_HTTP_PORT).toBe(String(DEFAULT_DEV_BACKEND_PORT))
  })

  it('preserves custom legacy AI_COMMAND_CENTER_PORT values as dev backend port overrides', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/openforge',
      env: { AI_COMMAND_CENTER_PORT: '19000' },
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('19000')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('19000')
  })

  it('prefers OPENFORGE_BACKEND_PORT over legacy AI_COMMAND_CENTER_PORT in dev', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/openforge',
      env: {
        OPENFORGE_BACKEND_PORT: '18000',
        AI_COMMAND_CENTER_PORT: '19000',
      },
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('18000')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('18000')
  })

  it('preserves explicit dev backend and hook client port overrides', () => {
    const result = buildTauriDevEnv({
      cwd: '/repo/openforge',
      env: {
        OPENFORGE_BACKEND_PORT: '18000',
        OPENFORGE_HTTP_PORT: '18001',
      },
      execFileSync: () => {
        throw new Error('not a git checkout')
      },
    })

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('18000')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('18001')
  })
})
