import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import PrReviewView from '../../../src/components/review/pr/PrReviewView.svelte'

interface ActivatedViewContribution {
  id: string
  component: typeof PrReviewView
}

type GithubSyncActivationResult = PluginActivationResult

export const PrReviewViewComponent = PrReviewView

export async function activate(_context: PluginContext): Promise<GithubSyncActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'pr_review',
          component: PrReviewView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
