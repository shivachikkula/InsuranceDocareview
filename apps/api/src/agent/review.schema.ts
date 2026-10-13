import { z } from 'zod';

const Severity = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const EvidenceSchema = z.object({
  documentId: z.string().describe('The document id exactly as given in the document label'),
  page: z.number().int().nullable().describe('1-based page number for PDFs, null otherwise'),
  quote: z.string().describe('Short verbatim quote or description of what was observed'),
});

/**
 * Structured output contract for the review agent. Everything the reviewer UI
 * shows comes from here, and every finding must cite evidence.
 */
export const ReviewResultSchema = z.object({
  recommendation: z.enum(['APPROVE', 'MANUAL_REVIEW', 'REQUEST_INFO']),
  riskScore: z.number().int().describe('0 (no concerns) to 100 (almost certainly invalid or fraudulent)'),
  summary: z.string().describe('3-6 sentence summary for the human adjuster'),
  extractedFields: z.array(
    z.object({
      name: z.string().describe('e.g. policyNumber, claimantName, incidentDate, providerName, invoiceTotal'),
      value: z.string(),
      documentId: z.string(),
      page: z.number().int().nullable(),
      confidence: Severity.describe('Extraction confidence: LOW, MEDIUM or HIGH'),
    }),
  ),
  documentTotal: z
    .number()
    .nullable()
    .describe('Total amount billed across the invoices/estimates/receipts, or null if none are legible'),
  incidentDateOnDocuments: z
    .string()
    .nullable()
    .describe('Incident/loss/service date stated on the documents as YYYY-MM-DD, or null'),
  findings: z.array(
    z.object({
      code: z
        .string()
        .describe(
          'UPPER_SNAKE_CASE, e.g. DATE_MISMATCH, NAME_MISMATCH, EXCLUDED_SERVICE, ' +
            'INCONSISTENT_NARRATIVE, POSSIBLE_ALTERATION, ILLEGIBLE_DOCUMENT, PROVIDER_FLAGGED',
        ),
      severity: Severity,
      description: z.string(),
      evidence: z.array(EvidenceSchema),
    }),
  ),
  missingDocuments: z.array(z.string()).describe('Documents a reviewer would need that were not provided'),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;
