export function parseCheckpointQuestion(checkpointData: string | null): string | null {
  if (checkpointData === null || checkpointData === undefined || checkpointData === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(checkpointData);

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
