<script lang="ts">
  import SharedPrOverviewTab from '@openforge/pr-review-ui/PrOverviewTab.svelte'
  import { prOverviewComments } from '../../../lib/stores'
  import { getPrOverviewComments, openUrl } from '../../../lib/ipc'
  import type { ReviewPullRequest, PrOverviewComment } from '../../../lib/types'

  interface Props {
    pr: ReviewPullRequest
  }

  let { pr }: Props = $props()

  async function loadComments(pr: ReviewPullRequest): Promise<PrOverviewComment[]> {
    return getPrOverviewComments(pr.repo_owner, pr.repo_name, pr.number)
  }

  function setComments(comments: PrOverviewComment[]) {
    $prOverviewComments = comments
  }
</script>

<SharedPrOverviewTab
  {pr}
  comments={$prOverviewComments}
  onCommentsChange={setComments}
  {loadComments}
  onOpenUrl={openUrl}
/>
