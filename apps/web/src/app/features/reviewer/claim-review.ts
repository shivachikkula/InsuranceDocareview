import { CurrencyPipe, DatePipe, JsonPipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ClaimsApiService, ReviewerDecision } from '../../core/claims-api.service';
import { errorMessage } from '../../core/errors';
import {
  AuditEntry,
  ClaimDetail,
  ClaimDocument,
  Evidence,
  IN_FLIGHT,
  Verdict,
} from '../../core/models';
import { LabelPipe, RiskBadge, SeverityChip, StatusChip } from '../../shared/ui';
import { DocumentViewer } from './document-viewer';

@Component({
  selector: 'app-claim-review',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTabsModule,
    MatTooltipModule,
    CurrencyPipe,
    DatePipe,
    JsonPipe,
    LabelPipe,
    StatusChip,
    SeverityChip,
    RiskBadge,
    DocumentViewer,
  ],
  templateUrl: './claim-review.html',
  styleUrl: './claim-review.scss',
})
export class ClaimReview {
  readonly id = input.required<string>();

  private readonly api = inject(ClaimsApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  private poll?: Subscription;

  protected readonly claim = signal<ClaimDetail | null>(null);
  protected readonly audit = signal<AuditEntry[]>([]);
  protected readonly selectedDoc = signal<ClaimDocument | null>(null);
  protected readonly selectedPage = signal<number | null>(null);
  protected readonly verdicts = signal<Record<string, Verdict>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected comment = '';
  protected requestedDocuments = '';

  protected readonly inFlight = computed(() => IN_FLIGHT.includes(this.claim()?.status ?? 'DRAFT'));
  protected readonly canReview = computed(
    () =>
      this.auth.hasRole(['REVIEWER', 'ADMIN']) &&
      ['MANUAL_REVIEW', 'READY_FOR_APPROVAL'].includes(this.claim()?.status ?? ''),
  );
  protected readonly canFinalApprove = computed(
    () =>
      this.auth.hasRole(['APPROVER', 'ADMIN']) && this.claim()?.status === 'PENDING_FINAL_APPROVAL',
  );
  protected readonly documentName = computed(() => {
    const names = new Map(this.claim()?.documents.map((d) => [d.id, d.fileName]));
    return (id: string | undefined) => (id && names.get(id)) || 'document';
  });

  constructor() {
    // untracked: only the route id should re-trigger loading, not signals read while subscribing.
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private load(id: string) {
    this.poll?.unsubscribe();
    this.poll = timer(0, 3000)
      .pipe(
        switchMap(() => this.api.get(id)),
        takeWhile((c) => IN_FLIGHT.includes(c.status), true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (c) => this.show(c),
        error: (err) => this.error.set(errorMessage(err)),
      });
    this.api
      .audit(id)
      .subscribe({ next: (entries) => this.audit.set(entries), error: () => this.audit.set([]) });
  }

  private show(c: ClaimDetail) {
    this.claim.set(c);
    this.verdicts.set(
      Object.fromEntries(
        (c.findings ?? []).filter((f) => f.verdict).map((f) => [f.id, f.verdict!]),
      ),
    );
    const current = this.selectedDoc();
    if (!current || !c.documents.some((d) => d.id === current.id)) {
      this.selectedDoc.set(c.documents[0] ?? null);
      this.selectedPage.set(null);
    }
  }

  openEvidence(evidence: { documentId?: string; page?: number | null }) {
    const doc = this.claim()?.documents.find((d) => d.id === evidence.documentId);
    if (!doc) return;
    this.selectedDoc.set(doc);
    this.selectedPage.set(evidence.page ?? null);
  }

  selectDocument(doc: ClaimDocument) {
    this.selectedDoc.set(doc);
    this.selectedPage.set(null);
  }

  setVerdict(findingId: string, verdict: Verdict) {
    this.verdicts.update((v) => ({ ...v, [findingId]: verdict }));
  }

  evidenceLabel(e: Evidence): string {
    return `${this.documentName()(e.documentId)}${e.page ? `, p.${e.page}` : ''}`;
  }

  async decide(action: ReviewerDecision['action']) {
    await this.run(
      () =>
        this.api.decide(this.id(), {
          action,
          comment: this.comment.trim(),
          findingVerdicts: this.verdicts(),
          requestedDocuments: this.requestedDocuments
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      {
        APPROVE: 'Claim approved',
        REJECT: 'Claim rejected',
        REQUEST_INFO: 'Information requested',
      }[action],
    );
  }

  async finalDecide(action: 'APPROVE' | 'REJECT') {
    await this.run(
      () => this.api.finalDecide(this.id(), { action, comment: this.comment.trim() }),
      action === 'APPROVE' ? 'Final approval given' : 'Claim rejected',
    );
  }

  async rerun() {
    await this.run(() => this.api.rerun(this.id()), 'Automated review restarted');
  }

  private async run(call: () => ReturnType<ClaimsApiService['get']>, success: string) {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(call());
      this.comment = '';
      this.requestedDocuments = '';
      this.snackBar.open(success, undefined, { duration: 3000 });
      this.load(this.id());
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
