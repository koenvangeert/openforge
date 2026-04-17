import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import PrReviewView from '../../../src/components/review/pr/PrReviewView.svelte'

interface ActivatedViewContribution {
  id: string
  component: typeof PrReviewView
}

interface GithubSyncActivationResult {
  contributions: Omit<PluginActivationResult['contributions'], 'views'> & {
    views: ActivatedViewContribution[]
  }
}

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
