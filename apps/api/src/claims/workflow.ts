import type { ClaimStatus, Role } from '../generated/prisma/client.js';

export type ReviewerAction = 'APPROVE' | 'REJECT' | 'REQUEST_INFO';
export type ApproverAction = 'APPROVE' | 'REJECT';

export class WorkflowError extends Error {}

const REVIEWABLE: ClaimStatus[] = ['MANUAL_REVIEW', 'READY_FOR_APPROVAL'];

/** Reviewer decision on an automatically reviewed claim. */
export function reviewerDecision(input: {
  status: ClaimStatus;
  action: ReviewerAction;
  amountClaimed: number;
  finalApprovalAmount: number;
  actorId: string;
  claimantId: string;
}): ClaimStatus {
  if (!REVIEWABLE.includes(input.status)) {
    throw new WorkflowError(`Claim in status ${input.status} cannot be reviewed`);
  }
  if (input.actorId === input.claimantId) {
    throw new WorkflowError('You cannot review your own claim');
  }
  switch (input.action) {
    case 'APPROVE':
      // Four-eyes rule: large claims need a second, independent approver.
      return input.amountClaimed >= input.finalApprovalAmount ? 'PENDING_FINAL_APPROVAL' : 'APPROVED';
    case 'REJECT':
      return 'REJECTED';
    case 'REQUEST_INFO':
      return 'PENDING_INFO';
  }
}

/** Second-level approval for claims above the final-approval threshold. */
export function approverDecision(input: {
  status: ClaimStatus;
  action: ApproverAction;
  actorId: string;
  reviewedById: string | null;
  claimantId: string;
}): ClaimStatus {
  if (input.status !== 'PENDING_FINAL_APPROVAL') {
    throw new WorkflowError(`Claim in status ${input.status} is not awaiting final approval`);
  }
  if (input.actorId === input.reviewedById) {
    throw new WorkflowError('Final approval must be given by someone other than the reviewer');
  }
  if (input.actorId === input.claimantId) {
    throw new WorkflowError('You cannot approve your own claim');
  }
  return input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
}

export const STAFF_ROLES: Role[] = ['REVIEWER', 'APPROVER', 'ADMIN'];
export const isStaff = (role: Role) => STAFF_ROLES.includes(role);
