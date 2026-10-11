export type Role = 'CLAIMANT' | 'REVIEWER' | 'APPROVER' | 'ADMIN';
export type LineOfBusiness = 'AUTO' | 'PROPERTY' | 'HEALTH';
export type ClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'PENDING_INFO'
  | 'MANUAL_REVIEW'
  | 'READY_FOR_APPROVAL'
  | 'PENDING_FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type DocumentType =
  | 'CLAIM_FORM'
  | 'INVOICE'
  | 'ESTIMATE'
  | 'POLICE_REPORT'
  | 'MEDICAL_REPORT'
  | 'PHOTO'
  | 'RECEIPT'
  | 'OTHER';
export type Verdict = 'VALID' | 'FALSE_POSITIVE';

export const DOCUMENT_TYPES: DocumentType[] = [
  'CLAIM_FORM',
  'INVOICE',
  'ESTIMATE',
  'POLICE_REPORT',
  'MEDICAL_REPORT',
  'PHOTO',
  'RECEIPT',
  'OTHER',
];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Policy {
  id: string;
  policyNumber: string;
  lineOfBusiness: LineOfBusiness;
  status: 'ACTIVE' | 'LAPSED' | 'CANCELLED';
  effectiveDate: string;
  expiryDate: string;
  coverageLimit: number;
  deductible: number;
}

export interface ClaimSummary {
  id: string;
  claimNumber: string;
  status: ClaimStatus;
  policyNumber: string;
  lineOfBusiness: LineOfBusiness;
  claimantName: string;
  incidentDate: string;
  submittedAt: string | null;
  amountClaimed: number;
  riskScore?: number | null;
  highFindings?: number;
  totalFindings?: number;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export interface ClaimDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
}

export interface Evidence {
  documentId?: string;
  page?: number | null;
  quote: string;
}

export interface Finding {
  id: string;
  source: 'RULE' | 'AI';
  code: string;
  severity: Severity;
  description: string;
  evidence: Evidence[];
  verdict: Verdict | null;
}

export interface ExtractedField {
  name: string;
  value: string;
  documentId: string;
  page: number | null;
  confidence: Severity;
}

export interface ClaimDetail {
  id: string;
  claimNumber: string;
  status: ClaimStatus;
  incidentDate: string;
  submittedAt: string | null;
  description: string;
  amountClaimed: number;
  providerName: string | null;
  missingDocuments: string[];
  decisionComment: string | null;
  claimant: { id: string; name: string; email: string };
  policy: Policy;
  documents: ClaimDocument[];
  // Staff-only fields
  riskScore?: number | null;
  recommendation?: 'APPROVE' | 'MANUAL_REVIEW' | 'REQUEST_INFO' | null;
  aiSummary?: string | null;
  aiModel?: string | null;
  extractedFields?: ExtractedField[];
  findings?: Finding[];
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  finalApprovalRequired?: boolean;
}

export interface AuditEntry {
  id: string;
  actorType: 'USER' | 'SYSTEM' | 'AI';
  actorId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Stats {
  byStatus: Partial<Record<ClaimStatus, number>>;
  findingVerdicts: Array<{ source: 'RULE' | 'AI'; verdict: Verdict; count: number }>;
  reviewerDecisions: number;
  aiOverrides: number;
}

/** Statuses during which the backend is still working on the claim. */
export const IN_FLIGHT: ClaimStatus[] = ['SUBMITTED', 'PROCESSING'];
