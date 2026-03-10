import { writePty } from './ipc'

/**
 * Writes text to a PTY and sends Enter (\r) as a separate write after a delay.
 *
 * Terminal CLIs like Claude Code detect bulk input arriving in a single read()
 * as "paste" and treat embedded \r as literal newlines. Splitting the text and
 * the Enter keystroke into separate writes ensures the CLI processes the text
 * first, then receives Enter as a distinct submit action.
 */
export async function writePtyWithSubmit(taskId: string, text: string): Promise<void> {
  await writePty(taskId, text)
  await new Promise(resolve => setTimeout(resolve, 50))
  await writePty(taskId, '\r')
}
