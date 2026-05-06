export interface ElectronAppPathConfigurator {
  setPath(name: 'userData', path: string): void
}

function nonEmptyEnv(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null
}

export function electronUserDataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmptyEnv(env.OPENFORGE_ELECTRON_USER_DATA_DIR)
}

export function configureElectronUserDataPath(
  app: ElectronAppPathConfigurator,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const userDataDir = electronUserDataDirFromEnv(env)
  if (!userDataDir) return null

  app.setPath('userData', userDataDir)
  return userDataDir
}
