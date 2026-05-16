<script lang="ts">
  import SharedAuthoredPrCard from '@openforge/pr-review-ui/AuthoredPrCard.svelte'
  import type { AuthoredPullRequest } from '../../../lib/types'

  interface Props {
    pr: AuthoredPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()
</script>

<SharedAuthoredPrCard {pr} {selected} {onClick} />
