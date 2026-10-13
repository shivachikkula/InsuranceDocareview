import type { FindingInput } from './review.types.js';

export interface RoutingThresholds {
  manualReviewAmount: number;
  manualReviewRiskScore: number;
}

export type RoutedStatus = 'PENDING_INFO' | 'MANUAL_REVIEW' | 'READY_FOR_APPROVAL';

/**
 * Decides where a claim goes after automated review. The automated pipeline
 * never approves or rejects on its own: the best outcome is
 * READY_FOR_APPROVAL, which still needs a human click.
 */
export function routeClaim(input: {
  amountClaimed: number;
  riskScore: number | null;
  aiRecommendation: 'APPROVE' | 'MANUAL_REVIEW' | 'REQUEST_INFO' | null;
  findings: FindingInput[];
  missingDocuments: string[];
  thresholds: RoutingThresholds;
}): { status: RoutedStatus; reasons: string[] } {
  if (input.missingDocuments.length > 0) {
    return { status: 'PENDING_INFO', reasons: [`Missing documents: ${input.missingDocuments.join(', ')}`] };
  }

  const reasons: string[] = [];
  if (input.aiRecommendation === null || input.riskScore === null) {
    reasons.push('AI review unavailable');
  }
  if (input.aiRecommendation === 'REQUEST_INFO') {
    reasons.push('AI requested more information');
  }
  if (input.aiRecommendation === 'MANUAL_REVIEW') {
    reasons.push('AI recommended manual review');
  }
  const high = input.findings.filter((f) => f.severity === 'HIGH');
  if (high.length > 0) {
    reasons.push(`${high.length} high-severity finding(s)`);
  }
  if (input.findings.some((f) => f.source === 'RULE' && f.severity !== 'LOW')) {
    reasons.push('Rule check failed');
  }
  if (input.riskScore !== null && input.riskScore >= input.thresholds.manualReviewRiskScore) {
    reasons.push(`Risk score ${input.riskScore} ≥ ${input.thresholds.manualReviewRiskScore}`);
  }
  if (input.amountClaimed >= input.thresholds.manualReviewAmount) {
    reasons.push(`Amount ≥ ${input.thresholds.manualReviewAmount}`);
  }

  return reasons.length > 0
    ? { status: 'MANUAL_REVIEW', reasons }
    : { status: 'READY_FOR_APPROVAL', reasons: ['No discrepancies found'] };
}
