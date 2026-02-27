import type { ReviewComment, ReviewSubmissionComment } from './types'

/**
 * Display data for comments on a single line.
 * Used by @git-diff-view/svelte 3xtendData for inline annotations.
 */
export interface CommentDisplayData {
  comments: Array<{
    body: string
    author?: string
    type: 'existing' | 'pending'
    createdAt?: string
    index?: number // For pending comment deletion
  }>
}

/**
 * Maps a side string ('L3FT' or 'RIGHT') to the 3xtendData object key.
 * @param side - The side string from a comment ('L3FT', 'RIGHT', or null)
 * @returns 'oldFile' for L3FT, 'newFile' for RIGHT or anything else
 */
export function sideToSplitSide(side: string | null): 'oldFile' | 'newFile' {
  return side === 'L3FT' ? 'oldFile' : 'newFile'
}

/**
 * Checks if a comment's path matches the target filename.
 * Uses the same matching logic as DiffViewer.svelte findLineRow():
 * exact match OR endsWith in either direction.
 */
function pathMatches(commentPath: string, targetFilename: string): boolean {
  if (commentPath === targetFilename) return true
  if (targetFilename.endsWith(commentPath)) return true
  if (commentPath.endsWith(targetFilename)) return true
  return false
}

/**
 * Builds 3xtendData-compatible objects from comment arrays.
 * Transforms ReviewComment[] and ReviewSubmissionComment[] into the per-file,
 * per-line data structure that @git-diff-view/svelte uses for inline annotations.
 *
 * @param filename - The target filename to filter comments for
 * @param existingComments - Array of ReviewComment objects from GitHub
 * @param pendingComments - Array of ReviewSubmissionComment objects (pending submission)
 * @returns Object with oldFile and newFile keys, each containing line-keyed comment data
 */
export function build3xtendData(
  filename: string,
  existingComments: ReviewComment[],
  pendingComments: ReviewSubmissionComment[]
): {
  oldFile: Record<string, { data: CommentDisplayData }>
  newFile: Record<string, { data: CommentDisplayData }>
} {
  const oldFile: Record<string, { data: CommentDisplayData }> = {}
  const newFile: Record<string, { data: CommentDisplayData }> = {}

  // Process existing comments
  for (const comment of existingComments) {
    // Skip general comments (no line number)
    if (comment.line === null) continue

    // Skip comments for other files
    if (!pathMatches(comment.path, filename)) continue

    // Determine target object (oldFile or newFile)
    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)

    // Initialize or append to the line's comment data
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }

    target[lineKey].data.comments.push({
      body: comment.body,
      author: comment.author,
      type: 'existing',
      createdAt: comment.created_at
    })
  }

  // Process pending comments
  for (let index = 0; index < pendingComments.length; index++) {
    const comment = pendingComments[index]

    // Skip comments for other files
    if (!pathMatches(comment.path, filename)) continue

    // Determine target object (oldFile or newFile)
    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)

    // Initialize or append to the line's comment data
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }

    target[lineKey].data.comments.push({
      body: comment.body,
      type: 'pending',
      index
    })
  }

  return { oldFile, newFile }
}
