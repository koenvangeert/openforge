import type { Action } from './types';
import { getProjectConfig, setProjectConfig } from './ipc';

export const DEFAULT_ACTIONS: Action[] = [
  {
    id: "builtin-start-implementation",
    name: "Start Implementation",
    prompt: "Implement this task. Create a branch, make the changes, and create a pull request when done.",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-plan-design",
    name: "Plan/Design",
    prompt: "Analyze this task and create a detailed implementation plan. Break it down into concrete steps, identify potential risks, and suggest the approach. Don't implement anything yet — just plan and document your findings.",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-manual-testing",
    name: "Manual Testing",
    prompt: "Create a comprehensive manual testing plan for this task. List all test scenarios with detailed steps, expected results, and edge cases. Include positive, negative, and boundary test cases.",
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
      return parsed;
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
    builtin: false,
    enabled: true,
  };
}

export function getEnabledActions(actions: Action[]): Action[] {
  return actions
    .filter((action) => action.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}
