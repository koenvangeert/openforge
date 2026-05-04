import { describe, expect, it } from 'vitest'
import { ELECTRON_RENDERER_URL, assertBackendPortAvailable, assertVitePortAvailable, buildElectronDevEnv, electronSidecarPath, resolveElectronDevBackendEnv, waitForVite } from './electron-dev.mjs'

describe('electron dev script environment', () => {
  it('starts Electron against the Vite dev server and disables sidecar warning when no sidecar path is configured', () => {
    const env = buildElectronDevEnv({ PATH: '/usr/bin' })

    expect(env.ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1420')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('enables sidecar mode when the dev launcher supplies a built Rust sidecar path', () => {
    const env = buildElectronDevEnv({ PATH: '/usr/bin' }, '/tmp/openforge-sidecar')

    expect(env.OPENFORGE_SIDECAR_PATH).toBe('/tmp/openforge-sidecar')
    expect(env.OPENFORGE_ELECTRON_SIDECAR).toBe('1')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBeUndefined()
  })

  it('preserves an explicit sidecar path instead of disabling the sidecar', () => {
    const env = buildElectronDevEnv({
      OPENFORGE_SIDECAR_PATH: '/tmp/openforge-sidecar',
      OPENFORGE_BACKEND_PORT: '18000',
    })

    expect(env.OPENFORGE_SIDECAR_PATH).toBe('/tmp/openforge-sidecar')
    expect(env.OPENFORGE_BACKEND_PORT).toBe('18000')
    expect(env.OPENFORGE_ELECTRON_SIDECAR).toBe('1')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBeUndefined()
  })

  it('derives the Electron sidecar executable from the shared Cargo target dir', () => {
    expect(electronSidecarPath('/tmp/openforge-target')).toContain('/tmp/openforge-target/debug/openforge')
  })

  it('uses one canonical loopback URL for Electron and Vite readiness', () => {
    expect(ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1420')
  })

  it('fails before launch when the Vite port is already occupied', async () => {
    await expect(assertVitePortAvailable({ isPortOpen: async () => true })).rejects.toThrow('Port 1420 is already in use')
  })

  it('fails before launch when a stale backend sidecar already owns an explicit backend port', async () => {
    await expect(assertBackendPortAvailable(18000, { isPortOpen: async (_host, port) => port === 18000 })).rejects.toThrow('Port 18000 is already in use')
  })

  it('selects the next free backend port when the default dev backend port is occupied', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { PATH: '/usr/bin' },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')

    const electronEnv = buildElectronDevEnv(result.env)
    expect(electronEnv.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(electronEnv.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('selects the next free dev port when an inherited legacy production port is present', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { AI_COMMAND_CENTER_PORT: '17422' },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('selects a free port when inherited OpenForge env uses the occupied default dev port', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: {
          OPENFORGE_BACKEND_PORT: '17642',
          OPENFORGE_HTTP_PORT: '17642',
        },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('preserves explicit hook client ports when selecting a free backend port', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { OPENFORGE_HTTP_PORT: '19000' },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('19000')
  })

  it('fails fast instead of reassigning an occupied explicit backend port', async () => {
    await expect(resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { OPENFORGE_BACKEND_PORT: '18000' },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 18000 },
    )).rejects.toThrow('Port 18000 is already in use')
  })

  it('fails fast instead of reassigning an occupied custom legacy backend port', async () => {
    await expect(resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { AI_COMMAND_CENTER_PORT: '19000' },
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 19000 },
    )).rejects.toThrow('Port 19000 is already in use')
  })

  it('fails fast if the spawned Vite process exits before readiness', async () => {
    const exitedProcess = {
      once: (_event, handler) => {
        handler(1, null)
        return exitedProcess
      },
      off: () => exitedProcess,
    }

    await expect(waitForVite(ELECTRON_RENDERER_URL, exitedProcess)).rejects.toThrow('Vite dev server exited before becoming ready')
  })
})
