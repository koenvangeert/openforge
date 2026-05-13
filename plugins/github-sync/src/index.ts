import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import PrReviewView from './review/pr/PrReviewView.svelte'
import { setPluginContext } from './pluginContext'

type GithubSyncActivationResult = PluginActivationResult

export const PrReviewViewComponent = PrReviewView

let stopNavigationListener: (() => void) | null = null

export async function activate(context: PluginContext): Promise<GithubSyncActivationResult> {
  setPluginContext(context)
  return {
    contributions: {
      views: [
        {
          id: 'pr_review',
          component: PrReviewView,
        },
      ],
      commands: [
        {
          id: 'refresh',
          execute: async () => {
            await context.invokeHost('forceGithubSync')
          },
        },
      ],
      backgroundServices: [
        {
          id: 'initial-sync',
          start: async () => {
            const navigation = await context.invokeHost('getNavigation') as { activeProjectId?: string | null }
            if (navigation.activeProjectId) {
              await context.invokeHost('forceGithubSync')
            }

            stopNavigationListener?.()
            stopNavigationListener = context.onEvent('navigation-changed', async (payload) => {
              const nextNavigation = payload as { activeProjectId?: string | null }
              if (nextNavigation.activeProjectId) {
                await context.invokeHost('forceGithubSync')
              }
            })
          },
          stop: async () => {
            stopNavigationListener?.()
            stopNavigationListener = null
          },
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {
  stopNavigationListener?.()
  stopNavigationListener = null
}
