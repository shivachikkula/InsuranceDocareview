import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuditEntry,
  ClaimDetail,
  ClaimDocument,
  ClaimSummary,
  DocumentType,
  Page,
  Policy,
  Stats,
  Verdict,
} from './models';

export interface QueueFilter {
  status?: string;
  sort?: 'risk' | 'amount' | 'submitted';
  page?: number;
  pageSize?: number;
}

export interface ReviewerDecision {
  action: 'APPROVE' | 'REJECT' | 'REQUEST_INFO';
  comment: string;
  findingVerdicts: Record<string, Verdict>;
  requestedDocuments: string[];
}

@Injectable({ providedIn: 'root' })
export class ClaimsApiService {
  private readonly http = inject(HttpClient);

  myPolicies() {
    return this.http.get<Policy[]>('/api/policies/mine');
  }

  create(body: {
    policyId: string;
    incidentDate: string;
    description: string;
    amountClaimed: number;
    providerName?: string;
  }) {
    return this.http.post<ClaimDetail>('/api/claims', body);
  }

  upload(claimId: string, type: DocumentType, file: File): Observable<HttpEvent<ClaimDocument>> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file);
    return this.http.post<ClaimDocument>(`/api/claims/${claimId}/documents`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  submit(claimId: string) {
    return this.http.post<ClaimDetail>(`/api/claims/${claimId}/submit`, {});
  }

  list(filter: QueueFilter = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<Page<ClaimSummary>>('/api/claims', { params });
  }

  get(claimId: string) {
    return this.http.get<ClaimDetail>(`/api/claims/${claimId}`);
  }

  documentBlob(claimId: string, documentId: string) {
    return this.http.get(`/api/claims/${claimId}/documents/${documentId}/content`, {
      responseType: 'blob',
    });
  }

  decide(claimId: string, decision: ReviewerDecision) {
    return this.http.post<ClaimDetail>(`/api/claims/${claimId}/decision`, decision);
  }

  finalDecide(claimId: string, decision: { action: 'APPROVE' | 'REJECT'; comment: string }) {
    return this.http.post<ClaimDetail>(`/api/claims/${claimId}/final-decision`, decision);
  }

  rerun(claimId: string) {
    return this.http.post<ClaimDetail>(`/api/claims/${claimId}/rerun`, {});
  }

  audit(claimId: string) {
    return this.http.get<AuditEntry[]>(`/api/claims/${claimId}/audit`);
  }

  stats() {
    return this.http.get<Stats>('/api/stats');
  }
}
