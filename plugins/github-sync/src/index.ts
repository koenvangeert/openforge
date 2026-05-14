import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'
import PrReviewView from './review/pr/PrReviewView.svelte'
import { setPluginContext } from './pluginContext'
import type { PluginContext } from './pluginContext'

export const PrReviewViewComponent = PrReviewView

function hostCommandId(command: string): string {
  return `openforge.${command}`
}

function createLegacyContext(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): PluginContext {
  return {
    pluginId: context.pluginId,
    invokeHost: (command, payload) => openforge.commands.invokeGlobal(hostCommandId(command), payload),
    invokeBackend: (method, payload) => openforge.backend.invoke(method, payload),
    onEvent: (event, handler) => {
      const subscription = openforge.events.onGlobal(hostCommandId(event), handler)
      return () => subscription.dispose()
    },
    storage: openforge.storage,
  }
}

export default defineFrontendPlugin({
  activate(openforge, context) {
    const legacyContext = createLegacyContext(openforge, context)
    setPluginContext(legacyContext)

    context.subscriptions.add(openforge.views.register({
      id: 'pr_review',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      order: 20,
      shortcut: 'Cmd+G',
      component: PrReviewView,
    }))

    context.subscriptions.add(openforge.commands.register({
      id: 'refresh',
      title: 'Refresh Pull Requests',
      shortcut: 'Cmd+Shift+R',
      handler: async () => {
        await legacyContext.invokeHost('forceGithubSync')
      },
    }))

    void (async () => {
      const navigation = await legacyContext.invokeHost('getNavigation') as { activeProjectId?: string | null }
      if (navigation.activeProjectId) {
        await legacyContext.invokeHost('forceGithubSync')
      }
    })()

    context.subscriptions.add(openforge.events.onGlobal('openforge.navigation-changed', (payload) => {
      const nextNavigation = payload as { activeProjectId?: string | null }
      if (nextNavigation.activeProjectId) {
        void legacyContext.invokeHost('forceGithubSync')
      }
    }))
  },
})
