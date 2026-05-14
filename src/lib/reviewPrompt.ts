/**
 * Compiles inline code comments, general comment cards, and PR review comments into a single agent prompt string.
 * Pure function with no side effects.
 */

export function compileReviewPrompt(
  taskTitle: string,
  inlineComments: { path: string; line: number; body: string }[],
  generalComments: { body: string }[],
  prReviewComments: { body: string; author: string; file_path: string | null; line_number: number | null }[] = []
): string {
  const hasInlineComments = inlineComments.length > 0;
  const hasGeneralComments = generalComments.length > 0;
  const hasPrReviewComments = prReviewComments.length > 0;

  // All empty: return empty string
  if (!hasInlineComments && !hasGeneralComments && !hasPrReviewComments) {
    return "";
  }

  const sections: string[] = [];
  sections.push(`Please address the following review feedback for task "${taskTitle}":\n`);

  // Code Comments section
  if (hasInlineComments) {
    sections.push("## Code Comments");
    inlineComments.forEach((comment, index) => {
      const location = `\`${comment.path}:${comment.line}\``;
      sections.push(`${index + 1}. ${location} — ${comment.body}`);
    });
    sections.push("");
  }

  // PR Review Comments section
  if (hasPrReviewComments) {
    sections.push("## PR Review Comments");
    prReviewComments.forEach((comment, index) => {
      const location = comment.file_path
        ? `\`${comment.file_path}${comment.line_number ? ':' + comment.line_number : ''}\``
        : '(general)';
      sections.push(`${index + 1}. [${comment.author}] ${location} — ${comment.body}`);
    });
    sections.push("");
  }

  // General Feedback section
  if (hasGeneralComments) {
    sections.push("## General Feedback");
    generalComments.forEach((comment, index) => {
      sections.push(`${index + 1}. ${comment.body}`);
    });
    sections.push("");
  }

  // Closing instruction
  sections.push("Please evaluate each review comment for validity and applicability before changing code.");
  sections.push("Only apply fixes for comments that are valid for the current code and task context.");
  sections.push("For valid code comments, fix the issue at the referenced location.");
  sections.push("For valid general feedback, investigate and fix the described behavior.");
  sections.push("If a comment is invalid, stale, already addressed, or not applicable, do not make a change for it; explain why in your response.");
  sections.push("After making all valid fixes, commit the changes and push to the branch.");

  return sections.join("\n");
}
