import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type { FileContent, FileEntry } from '@openforge/plugin-sdk/domain'

export async function fsReadDir(api: FrontendOpenForgeAPI, projectId: string, dirPath: string | null): Promise<FileEntry[]> {
  return api.fs.readDir({ projectId, path: dirPath })
}

export async function fsReadFile(api: FrontendOpenForgeAPI, projectId: string, filePath: string): Promise<FileContent> {
  return api.fs.readFile({ projectId, path: filePath })
}

export async function openUrl(api: FrontendOpenForgeAPI, url: string): Promise<void> {
  await api.system.openUrl(url)
}
