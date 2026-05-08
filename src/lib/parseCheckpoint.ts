function isPtyInstanceMetadataOnly(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false

  const metadataKeys = new Set(['pty_instance_id', 'ptyInstanceId'])
  const keys = Object.keys(parsed)
  return keys.length > 0 && keys.every(key => metadataKeys.has(key))
}

export function parsePtyInstanceId(checkpointData: string | null): number | null {
  if (checkpointData === null || checkpointData === undefined || checkpointData === '') {
    return null
  }

  try {
    const parsed = JSON.parse(checkpointData)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const value = parsed.pty_instance_id ?? parsed.ptyInstanceId
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function parseCheckpointQuestion(checkpointData: string | null): string | null {
  if (checkpointData === null || checkpointData === undefined || checkpointData === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(checkpointData);

    if (isPtyInstanceMetadataOnly(parsed)) return null

    const firstQuestion = Array.isArray(parsed.properties?.questions)
      ? parsed.properties.questions[0]
      : null;

    const candidates = [
      firstQuestion?.question,
      firstQuestion?.header,
      parsed.properties?.description,
      parsed.properties?.title,
      parsed.properties?.permission?.description,
      parsed.properties?.message,
      parsed.message,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate.length > 500 ? candidate.slice(0, 500) + '...' : candidate;
      }
    }

    return 'Agent is waiting for input';
  } catch {
    return 'Agent is waiting for input';
  }
}
