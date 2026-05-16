import { hasMergeConflicts, isReadyToMerge, type MergeStatusInfo } from '@openforge/plugin-sdk/domain';

export type PrChipSurface = 'compact' | 'detail';

export type PrChipVariant = 'success' | 'error' | 'pending' | 'muted' | 'neutral' | 'done' | 'merged';
export type PrChipType = 'draft' | 'ci' | 'review' | 'merge';
export type PrChipIcon = 'check' | 'cross' | 'clock' | null;

export interface PrStatusChipSpec {
  type: PrChipType;
  label: string;
  variant: PrChipVariant;
  surface: PrChipSurface;
  icon?: PrChipIcon;
  pulse?: boolean;
}

export interface PrInput extends MergeStatusInfo {
  draft?: boolean;
  is_queued?: boolean;
  ci_status?: string | null;
  review_status?: string | null;
}

export function getPrStatusChips(pr: PrInput, surface: PrChipSurface): PrStatusChipSpec[] {
  const chips: PrStatusChipSpec[] = [];

  // Draft status
  if (pr.draft && pr.state === 'open') {
    chips.push({
      type: 'draft',
      label: 'Draft',
      variant: 'muted',
      surface
    });
  }

  // CI Status
  if (pr.ci_status && pr.ci_status !== 'none' && pr.state === 'open') {
    if (surface === 'compact') {
      const labels: Record<string, string> = {
        'success': 'CI Passed',
        'failure': 'CI Failed',
        'pending': 'CI Pending'
      };
      chips.push({
        type: 'ci',
        label: labels[pr.ci_status] || pr.ci_status,
        variant: pr.ci_status === 'success' ? 'success' : pr.ci_status === 'failure' ? 'error' : 'pending',
        surface
      });
    } else {
      const labels: Record<string, string> = {
        'success': 'Passing',
        'failure': 'Failing',
        'pending': 'Running'
      };
      const icons: Record<string, PrChipIcon> = {
        'success': 'check',
        'failure': 'cross',
        'pending': 'clock'
      };
      chips.push({
        type: 'ci',
        label: labels[pr.ci_status] || pr.ci_status,
        variant: pr.ci_status === 'success' ? 'success' : pr.ci_status === 'failure' ? 'error' : 'pending',
        icon: icons[pr.ci_status] || null,
        surface
      });
    }
  }

  // Review Status
  const normalizedReviewStatus = pr.review_status === 'pending' || pr.review_status === 'review_required' 
    ? 'review_required' 
    : pr.review_status;

  if (normalizedReviewStatus && normalizedReviewStatus !== 'none' && pr.state === 'open') {
    if (surface === 'compact') {
      const labels: Record<string, string> = {
        'approved': 'Approved',
        'changes_requested': 'Changes Req.',
        'review_required': 'Needs Review'
      };
      chips.push({
        type: 'review',
        label: labels[normalizedReviewStatus] || normalizedReviewStatus,
        variant: normalizedReviewStatus === 'approved' ? 'success' : normalizedReviewStatus === 'changes_requested' ? 'pending' : 'neutral',
        surface
      });
    } else {
      const labels: Record<string, string> = {
        'approved': 'Approved',
        'changes_requested': 'Changes Requested',
        'review_required': 'Review Required'
      };
      const icons: Record<string, PrChipIcon> = {
        'approved': 'check',
        'changes_requested': 'cross',
        'review_required': 'clock'
      };
      chips.push({
        type: 'review',
        label: labels[normalizedReviewStatus] || normalizedReviewStatus,
        variant: normalizedReviewStatus === 'approved' ? 'success' : normalizedReviewStatus === 'changes_requested' ? 'pending' : 'neutral',
        icon: icons[normalizedReviewStatus] || null,
        surface
      });
    }
  }

  // Merge Status
  if (pr.state === 'merged') {
    chips.push({
      type: 'merge',
      label: surface === 'compact' ? 'merged' : 'Merged',
      variant: 'merged',
      icon: surface === 'detail' ? 'check' : undefined,
      surface
    });
  } else if (hasMergeConflicts(pr)) {
    chips.push({
      type: 'merge',
      label: 'Merge Conflict',
      variant: 'error',
      icon: surface === 'detail' ? 'cross' : undefined,
      surface
    });
  } else if (pr.is_queued && pr.state === 'open') {
    chips.push({
      type: 'merge',
      label: surface === 'compact' ? 'Queued' : 'In Merge Queue',
      variant: 'done',
      icon: surface === 'detail' ? 'check' : undefined,
      surface
    });
  } else if (pr.is_queued === false && pr.state === 'open' && isReadyToMerge(pr)) {
    chips.push({
      type: 'merge',
      label: surface === 'compact' ? 'Ready to Merge' : 'Ready to Merge',
      variant: 'done',
      icon: surface === 'detail' ? 'check' : undefined,
      surface
    });
  }

  return chips;
}
