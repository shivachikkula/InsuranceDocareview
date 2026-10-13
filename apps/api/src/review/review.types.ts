export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Evidence {
  documentId?: string;
  page?: number | null;
  quote: string;
}

export interface FindingInput {
  source: 'RULE' | 'AI';
  code: string;
  severity: Severity;
  description: string;
  evidence: Evidence[];
}

/** Plain snapshot of everything the deterministic rules need. */
export interface ClaimSnapshot {
  id: string;
  lineOfBusiness: 'AUTO' | 'PROPERTY' | 'HEALTH';
  incidentDate: Date;
  submittedAt: Date;
  amountClaimed: number;
  policy: {
    status: 'ACTIVE' | 'LAPSED' | 'CANCELLED';
    effectiveDate: Date;
    expiryDate: Date;
    coverageLimit: number;
    deductible: number;
  };
  documents: Array<{ id: string; type: string; sha256: string; fileName: string }>;
  /** Documents with the same hash attached to *other* claims. */
  reusedDocuments: Array<{ documentId: string; otherClaimNumber: string }>;
  /** Other submitted claims on the same policy. */
  otherClaims: Array<{ claimNumber: string; incidentDate: Date; amountClaimed: number }>;
}
