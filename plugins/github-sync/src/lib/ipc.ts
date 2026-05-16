import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type {
  AgentReviewComment,
  AuthoredPullRequest,
  PrFileDiff,
  PrOverviewComment,
  ReviewComment,
  ReviewPullRequest,
  ReviewSubmissionComment,
} from '@openforge/plugin-sdk/domain'

function host<T>(api: FrontendOpenForgeAPI, command: string, payload?: Record<string, unknown>): Promise<T> {
  return api.commands.invokeGlobal<T>(`openforge.${command}`, payload)
}

export async function fetchReviewPrs(api: FrontendOpenForgeAPI): Promise<ReviewPullRequest[]> { return host(api, 'fetchReviewPrs') }
export async function getReviewPrs(api: FrontendOpenForgeAPI): Promise<ReviewPullRequest[]> { return host(api, 'getReviewPrs') }
export async function fetchAuthoredPrs(api: FrontendOpenForgeAPI): Promise<AuthoredPullRequest[]> { return host(api, 'fetchAuthoredPrs') }
export async function getAuthoredPrs(api: FrontendOpenForgeAPI): Promise<AuthoredPullRequest[]> { return host(api, 'getAuthoredPrs') }
export async function getPrFileDiffs(api: FrontendOpenForgeAPI, owner: string, repo: string, prNumber: number): Promise<PrFileDiff[]> { return host(api, 'getPrFileDiffs', { owner, repo, prNumber }) }
export async function openUrl(api: FrontendOpenForgeAPI, url: string): Promise<void> { await api.system.openUrl(url) }
export async function getReviewComments(api: FrontendOpenForgeAPI, owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> { return host(api, 'getReviewComments', { owner, repo, prNumber }) }
export async function getPrOverviewComments(api: FrontendOpenForgeAPI, owner: string, repo: string, prNumber: number): Promise<PrOverviewComment[]> { return host(api, 'getPrOverviewComments', { owner, repo, prNumber }) }
export async function getFileContent(api: FrontendOpenForgeAPI, owner: string, repo: string, sha: string): Promise<string> { return host(api, 'getFileContent', { owner, repo, sha }) }
export async function getFileAtRef(api: FrontendOpenForgeAPI, owner: string, repo: string, path: string, refSha: string): Promise<string> { return host(api, 'getFileAtRef', { owner, repo, path, refSha }) }
export async function markReviewPrViewed(api: FrontendOpenForgeAPI, prId: number, headSha: string): Promise<void> { await host(api, 'markReviewPrViewed', { prId, headSha }) }
export async function startAgentReview(api: FrontendOpenForgeAPI, repoOwner: string, repoName: string, prNumber: number, headRef: string, baseRef: string, prTitle: string, prBody: string | null, reviewPrId: number): Promise<{ review_session_key: string }> { return host(api, 'startAgentReview', { repoOwner, repoName, prNumber, headRef, baseRef, prTitle, prBody, reviewPrId }) }
export async function getAgentReviewComments(api: FrontendOpenForgeAPI, reviewPrId: number): Promise<AgentReviewComment[]> { return host(api, 'getAgentReviewComments', { reviewPrId }) }
export async function updateAgentReviewCommentStatus(api: FrontendOpenForgeAPI, commentId: number, status: string): Promise<void> { await host(api, 'updateAgentReviewCommentStatus', { commentId, status }) }
export async function abortAgentReview(api: FrontendOpenForgeAPI, reviewSessionKey: string): Promise<void> { await host(api, 'abortAgentReview', { reviewSessionKey }) }
export async function getProjectConfig(api: FrontendOpenForgeAPI, projectId: string, key: string): Promise<string | null> { return api.projectConfig.get<string>(key, projectId) }
export async function setProjectConfig(api: FrontendOpenForgeAPI, projectId: string, key: string, value: string): Promise<void> { await api.projectConfig.set(key, value, projectId) }
export async function submitPrReview(api: FrontendOpenForgeAPI, owner: string, repo: string, prNumber: number, event: string, body: string, comments: ReviewSubmissionComment[], commitId: string): Promise<void> { await host(api, 'submitPrReview', { owner, repo, prNumber, event, body, comments, commitId }) }
