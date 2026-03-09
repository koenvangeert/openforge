import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { pushNavState, navigateBack } from './navigation';
import { currentView, selectedTaskId, activeProjectId, selectedReviewPr, selectedSkillName } from './stores';

describe('navigation - activeProjectId', () => {
  beforeEach(() => {
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
    // Clear history by navigating back until empty
    while (navigateBack()) { /* drain */ }
    // Reset stores after draining
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
  });

  it('pushNavState captures activeProjectId and navigateBack restores it', () => {
    activeProjectId.set('proj-1');
    pushNavState();

    // Change to different project
    activeProjectId.set('proj-2');
    currentView.set('settings');

    const result = navigateBack();
    expect(result).toBe(true);
    expect(get(activeProjectId)).toBe('proj-1');
    expect(get(currentView)).toBe('board');
  });

  it('navigateBack restores activeProjectId to a different value', () => {
    activeProjectId.set('proj-A');
    currentView.set('board');
    pushNavState();

    activeProjectId.set('proj-B');
    currentView.set('workqueue');
    pushNavState();

    activeProjectId.set('proj-C');

    navigateBack();
    expect(get(activeProjectId)).toBe('proj-B');

    navigateBack();
    expect(get(activeProjectId)).toBe('proj-A');
  });

  it('navigateBack restores null activeProjectId', () => {
    activeProjectId.set(null);
    pushNavState();

    activeProjectId.set('proj-2');

    navigateBack();
    expect(get(activeProjectId)).toBeNull();
  });
});
