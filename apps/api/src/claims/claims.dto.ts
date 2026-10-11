import { z } from 'zod';

export const CreateClaimSchema = z.object({
  policyId: z.uuid(),
  incidentDate: z.iso.date(),
  description: z.string().trim().min(20).max(5000),
  amountClaimed: z.number().positive().max(10_000_000),
  providerName: z.string().trim().max(200).optional(),
});
export type CreateClaimDto = z.infer<typeof CreateClaimSchema>;

export const UploadDocumentSchema = z.object({
  type: z.enum([
    'CLAIM_FORM',
    'INVOICE',
    'ESTIMATE',
    'POLICE_REPORT',
    'MEDICAL_REPORT',
    'PHOTO',
    'RECEIPT',
    'OTHER',
  ]),
});

export const ReviewerDecisionSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']),
    comment: z.string().trim().max(5000).default(''),
    findingVerdicts: z.record(z.uuid(), z.enum(['VALID', 'FALSE_POSITIVE'])).default({}),
    requestedDocuments: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((d) => d.action === 'APPROVE' || d.comment.length > 0, {
    message: 'A comment is required to reject or request information',
    path: ['comment'],
  })
  .refine((d) => d.action !== 'REQUEST_INFO' || d.requestedDocuments.length > 0, {
    message: 'List the documents you need',
    path: ['requestedDocuments'],
  });
export type ReviewerDecisionDto = z.infer<typeof ReviewerDecisionSchema>;

export const ApproverDecisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().min(1).max(5000),
});
export type ApproverDecisionDto = z.infer<typeof ApproverDecisionSchema>;

export const ListClaimsSchema = z.object({
  status: z.string().optional(),
  sort: z.enum(['risk', 'amount', 'submitted']).default('submitted'),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListClaimsDto = z.infer<typeof ListClaimsSchema>;
