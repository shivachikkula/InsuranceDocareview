import { approverDecision, reviewerDecision, WorkflowError } from './workflow.js';

const review = {
  status: 'MANUAL_REVIEW' as const,
  action: 'APPROVE' as const,
  amountClaimed: 5000,
  finalApprovalAmount: 25_000,
  actorId: 'reviewer',
  claimantId: 'claimant',
};

describe('reviewerDecision', () => {
  it('approves small claims directly', () => {
    expect(reviewerDecision(review)).toBe('APPROVED');
  });

  it('requires final approval for large claims', () => {
    expect(reviewerDecision({ ...review, amountClaimed: 30_000 })).toBe('PENDING_FINAL_APPROVAL');
  });

  it('maps reject and request-info', () => {
    expect(reviewerDecision({ ...review, action: 'REJECT' })).toBe('REJECTED');
    expect(reviewerDecision({ ...review, action: 'REQUEST_INFO' })).toBe('PENDING_INFO');
  });

  it('refuses claims that are not awaiting review', () => {
    expect(() => reviewerDecision({ ...review, status: 'PROCESSING' })).toThrow(WorkflowError);
  });

  it('refuses self-review', () => {
    expect(() => reviewerDecision({ ...review, actorId: 'claimant' })).toThrow(WorkflowError);
  });
});

describe('approverDecision', () => {
  const approve = {
    status: 'PENDING_FINAL_APPROVAL' as const,
    action: 'APPROVE' as const,
    actorId: 'approver',
    reviewedById: 'reviewer',
    claimantId: 'claimant',
  };

  it('approves and rejects', () => {
    expect(approverDecision(approve)).toBe('APPROVED');
    expect(approverDecision({ ...approve, action: 'REJECT' })).toBe('REJECTED');
  });

  it('enforces four-eyes: approver must differ from reviewer', () => {
    expect(() => approverDecision({ ...approve, actorId: 'reviewer' })).toThrow(WorkflowError);
  });

  it('only acts on claims awaiting final approval', () => {
    expect(() => approverDecision({ ...approve, status: 'MANUAL_REVIEW' })).toThrow(WorkflowError);
  });
});
