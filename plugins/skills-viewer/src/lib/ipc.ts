import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type { SkillInfo } from '@openforge/plugin-sdk/domain'

export async function listOpenCodeSkills(api: FrontendOpenForgeAPI, projectId: string): Promise<SkillInfo[]> {
  return api.commands.invokeGlobal<SkillInfo[]>('openforge.listOpenCodeSkills', { projectId })
}

export async function saveSkillContent(
  api: FrontendOpenForgeAPI,
  projectId: string,
  name: string,
  level: SkillInfo['level'],
  sourceDir: string,
  content: string,
): Promise<void> {
  await api.commands.invokeGlobal('openforge.saveSkillContent', { projectId, name, level, sourceDir, content })
}

export async function openUrl(api: FrontendOpenForgeAPI, url: string): Promise<void> {
  await api.system.openUrl(url)
}
