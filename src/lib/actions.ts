import type { Action } from './types';
import { getProjectConfig, setProjectConfig } from './ipc';

export const DEFAULT_ACTIONS: Action[] = [
  {
    id: "builtin-go",
    name: "Go",
    prompt: "",
    agent: null,
    builtin: true,
    enabled: true,
  },
];

export async function loadActions(projectId: string): Promise<Action[]> {
  const stored = await getProjectConfig(projectId, 'actions');
  
  if (!stored) {
    await saveActions(projectId, DEFAULT_ACTIONS);
    return DEFAULT_ACTIONS;
  }
  
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((a: Action) => ({ ...a, agent: a.agent ?? null }));
    }
  } catch {
    // Fall through to seed defaults
  }
  
  await saveActions(projectId, DEFAULT_ACTIONS);
  return DEFAULT_ACTIONS;
}

export async function saveActions(projectId: string, actions: Action[]): Promise<void> {
  await setProjectConfig(projectId, 'actions', JSON.stringify(actions));
}

export function createAction(name: string, prompt: string): Action {
  return {
    id: crypto.randomUUID(),
    name,
    prompt,
    agent: null,
    builtin: false,
    enabled: true,
  };
}

export function getEnabledActions(actions: Action[]): Action[] {
  return actions
    .filter((action) => action.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}
