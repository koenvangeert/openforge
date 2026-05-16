import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import PrReviewView from './review/pr/PrReviewView.svelte'

export const PrReviewViewComponent = PrReviewView

function hostCommandId(command: string): string {
  return `openforge.${command}`
}

export default defineFrontendPlugin({
  activate(openforge, context) {
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
        await openforge.commands.invokeGlobal(hostCommandId('forceGithubSync'))
      },
    }))

    void (async () => {
      const navigation = await openforge.commands.invokeGlobal<{ activeProjectId?: string | null }>(hostCommandId('getNavigation'))
      if (navigation.activeProjectId) {
        await openforge.commands.invokeGlobal(hostCommandId('forceGithubSync'))
      }
    })()

    context.subscriptions.add(openforge.events.onGlobal('openforge.navigation-changed', (payload) => {
      const nextNavigation = payload as { activeProjectId?: string | null }
      if (nextNavigation.activeProjectId) {
        void openforge.commands.invokeGlobal(hostCommandId('forceGithubSync'))
      }
    }))
  },
})
