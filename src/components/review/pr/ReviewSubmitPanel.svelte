<script lang="ts">
  import SharedReviewSubmitPanel from '@openforge/pr-review-ui/ReviewSubmitPanel.svelte'
  import { pendingManualComments } from '../../../lib/stores'
  import { submitPrReview } from '../../../lib/ipc'
  import type { ReviewSubmissionComment } from '../../../lib/types'

  interface Props {
    repoOwner: string
    repoName: string
    prNumber: number
    commitId: string
  }

  type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

  interface SubmitReviewRequest {
    repoOwner: string
    repoName: string
    prNumber: number
    event: ReviewEvent
    body: string
    comments: ReviewSubmissionComment[]
    commitId: string
  }

  let { repoOwner, repoName, prNumber, commitId }: Props = $props()

  function setPendingComments(comments: ReviewSubmissionComment[]) {
    $pendingManualComments = comments
  }

  async function handleSubmitReview(request: SubmitReviewRequest) {
    await submitPrReview(
      request.repoOwner,
      request.repoName,
      request.prNumber,
      request.event,
      request.body,
      request.comments,
      request.commitId
    )
  }
</script>

<SharedReviewSubmitPanel
  {repoOwner}
  {repoName}
  {prNumber}
  {commitId}
  pendingComments={$pendingManualComments}
  onPendingCommentsChange={setPendingComments}
  onSubmitReview={handleSubmitReview}
/>
