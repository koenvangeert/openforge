import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'
import SkillsView from './SkillsView.svelte'
import { setPluginContext } from './pluginContext'
import type { PluginContext } from './pluginContext'

export const SkillsViewComponent = SkillsView

function createLegacyContext(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): PluginContext {
  return {
    pluginId: context.pluginId,
    invokeHost: async (command, payload) => {
      const request = payload as Record<string, unknown> | undefined
      switch (command) {
        case 'openUrl':
          return openforge.system.openUrl(String(request?.url ?? ''))
        case 'navigate':
          await openforge.events.emitGlobal('openforge.navigation.requested', request ?? {})
          return openforge.context.getSnapshot()
        case 'listOpenCodeSkills':
        case 'saveSkillContent':
          throw new Error(`Skills host command ${command} is not available through the runtime API yet`)
        default:
          throw new Error(`Unsupported skills-viewer host command: ${command}`)
      }
    },
    invokeBackend: (method, payload) => openforge.backend.invoke(method, payload),
    onEvent: (event, handler) => {
      const subscription = openforge.events.onGlobal(event, handler)
      return () => subscription.dispose()
    },
    storage: openforge.storage,
  }
}

export default defineFrontendPlugin({
  activate(openforge, context) {
    setPluginContext(createLegacyContext(openforge, context))
    context.subscriptions.add(openforge.views.register({
      id: 'skills',
      title: 'Skills',
      icon: 'sparkles',
      placement: 'rail',
      order: 30,
      shortcut: 'Cmd+L',
      component: SkillsView,
    }))
  },
})
