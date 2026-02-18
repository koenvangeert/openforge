/**
 * Compiles inline code comments and general comment cards into a single agent prompt string.
 * Pure function with no side effects.
 */

export function compileReviewPrompt(
  taskTitle: string,
  inlineComments: { path: string; line: number; body: string }[],
  generalComments: { body: string }[]
): string {
  const hasInlineComments = inlineComments.length > 0;
  const hasGeneralComments = generalComments.length > 0;

  // Both empty: return empty string
  if (!hasInlineComments && !hasGeneralComments) {
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

  // General Feedback section
  if (hasGeneralComments) {
    sections.push("## General Feedback");
    generalComments.forEach((comment, index) => {
      sections.push(`${index + 1}. ${comment.body}`);
    });
    sections.push("");
  }

  // Closing instruction
  sections.push("Please address ALL items above. For code comments, fix the issue at the referenced location.");
  sections.push("For general feedback, investigate and fix the described behavior.");

  return sections.join("\n");
}
