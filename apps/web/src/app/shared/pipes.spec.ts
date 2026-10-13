import { ClaimantStatusPipe } from '../features/claimant/claimant-status';
import { LabelPipe } from './ui';

describe('LabelPipe', () => {
  it('humanises enum values', () => {
    expect(new LabelPipe().transform('PENDING_FINAL_APPROVAL')).toBe('Pending final approval');
    expect(new LabelPipe().transform(null)).toBe('');
  });
});

describe('ClaimantStatusPipe', () => {
  it('hides internal review stages from claimants', () => {
    const pipe = new ClaimantStatusPipe();
    for (const status of [
      'MANUAL_REVIEW',
      'READY_FOR_APPROVAL',
      'PENDING_FINAL_APPROVAL',
    ] as const) {
      expect(pipe.transform(status)).toBe('Under review');
    }
    expect(pipe.transform('PENDING_INFO')).toContain('Action needed');
  });
});
