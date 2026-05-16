<script lang="ts">
  import SharedReviewPrCard from '@openforge/pr-review-ui/ReviewPrCard.svelte'
  import type { ReviewPullRequest } from '../../../lib/types'

  interface Props {
    pr: ReviewPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()
</script>

<SharedReviewPrCard {pr} {selected} {onClick} />
