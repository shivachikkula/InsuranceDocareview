import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
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
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { ClaimsApiService } from '../../core/claims-api.service';
import { errorMessage } from '../../core/errors';
import { ClaimDetail, DOCUMENT_TYPES, DocumentType, IN_FLIGHT } from '../../core/models';
import { LabelPipe } from '../../shared/ui';
import { ClaimantStatusPipe } from './claimant-status';

@Component({
  selector: 'app-claimant-claim',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressBarModule,
    CurrencyPipe,
    DatePipe,
    LabelPipe,
    ClaimantStatusPipe,
  ],
  template: `
    <div class="page narrow">
      <a mat-button routerLink="/my-claims"><mat-icon>arrow_back</mat-icon> My claims</a>
      @if (claim(); as c) {
        <div class="row">
          <h1>Claim {{ c.claimNumber }}</h1>
          <span class="spacer"></span>
          <strong>{{ c.status | claimantStatus }}</strong>
        </div>
        @if (inFlight()) {
          <mat-progress-bar mode="indeterminate" />
          <p class="muted">We are checking your claim. This usually takes a minute or two.</p>
        }

        @if (c.status === 'PENDING_INFO') {
          <mat-card appearance="outlined" class="attention">
            <mat-card-content>
              <h2><mat-icon inline>info</mat-icon> We need more information</h2>
              @if (c.decisionComment) {
                <p>{{ c.decisionComment }}</p>
              }
              <ul>
                @for (doc of c.missingDocuments; track doc) {
                  <li>{{ doc | label }}</li>
                }
              </ul>
              <p class="muted">Upload the documents below, then resubmit.</p>
            </mat-card-content>
          </mat-card>
        }

        @if (c.status === 'APPROVED' || c.status === 'REJECTED') {
          <mat-card appearance="outlined" class="attention">
            <mat-card-content>
              <h2>Decision: {{ c.status | claimantStatus }}</h2>
              @if (c.decisionComment) {
                <p>{{ c.decisionComment }}</p>
              }
            </mat-card-content>
          </mat-card>
        }

        <mat-card appearance="outlined">
          <mat-card-content>
            <dl>
              <dt>Policy</dt>
              <dd>{{ c.policy.policyNumber }} · {{ c.policy.lineOfBusiness | label }}</dd>
              <dt>Incident date</dt>
              <dd>{{ c.incidentDate | date: 'longDate' : 'UTC' }}</dd>
              <dt>Amount claimed</dt>
              <dd>{{ c.amountClaimed | currency }}</dd>
              @if (c.providerName) {
                <dt>Provider</dt>
                <dd>{{ c.providerName }}</dd>
              }
              <dt>Description</dt>
              <dd class="pre">{{ c.description }}</dd>
            </dl>
          </mat-card-content>
        </mat-card>

        <h2>Documents</h2>
        <mat-card appearance="outlined">
          <mat-list>
            @for (d of c.documents; track d.id) {
              <mat-list-item>
                <mat-icon matListItemIcon>{{
                  d.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'
                }}</mat-icon>
                <span matListItemTitle>{{ d.fileName }}</span>
                <span matListItemLine
                  >{{ d.type | label }} · {{ d.uploadedAt | date: 'short' }}</span
                >
              </mat-list-item>
            } @empty {
              <mat-list-item><span class="muted">No documents yet.</span></mat-list-item>
            }
          </mat-list>

          @if (editable()) {
            <mat-card-content class="upload">
              <div class="row">
                <mat-form-field>
                  <mat-label>Document type</mat-label>
                  <mat-select [(ngModel)]="docType">
                    @for (t of documentTypes; track t) {
                      <mat-option [value]="t">{{ t | label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <input
                  #file
                  type="file"
                  hidden
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt"
                  (change)="upload(file)"
                />
                <button
                  mat-stroked-button
                  (click)="file.click()"
                  [disabled]="uploadProgress() !== null"
                >
                  <mat-icon>upload_file</mat-icon> Choose file
                </button>
              </div>
              @if (uploadProgress() !== null) {
                <mat-progress-bar mode="determinate" [value]="uploadProgress()" />
              }
              <p class="muted hint">{{ requiredHint() }}</p>
            </mat-card-content>
          }
        </mat-card>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        @if (editable()) {
          <div class="row actions">
            <span class="spacer"></span>
            <button
              mat-flat-button
              (click)="submit()"
              [disabled]="busy() || c.documents.length === 0"
            >
              {{ c.status === 'PENDING_INFO' ? 'Resubmit claim' : 'Submit claim' }}
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .narrow {
      max-width: 820px;
    }
    mat-card {
      margin-bottom: 16px;
    }
    .attention {
      border-color: var(--mat-sys-tertiary);
    }
    dl {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 8px 16px;
      margin: 0;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
    }
    .pre {
      white-space: pre-wrap;
    }
    .upload {
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding-top: 16px;
    }
    .hint {
      font: var(--mat-sys-body-small);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ClaimantClaim {
  readonly id = input.required<string>();

  private readonly api = inject(ClaimsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private poll?: Subscription;

  protected readonly documentTypes = DOCUMENT_TYPES;
  protected docType: DocumentType = 'CLAIM_FORM';
  protected readonly claim = signal<ClaimDetail | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly uploadProgress = signal<number | null>(null);
  protected readonly inFlight = computed(() => IN_FLIGHT.includes(this.claim()?.status ?? 'DRAFT'));
  protected readonly editable = computed(() =>
    ['DRAFT', 'PENDING_INFO'].includes(this.claim()?.status ?? ''),
  );
  protected readonly requiredHint = computed(() => {
    switch (this.claim()?.policy.lineOfBusiness) {
      case 'AUTO':
        return 'Needed: claim form, repair invoice or estimate, and photos of the damage.';
      case 'PROPERTY':
        return 'Needed: claim form, invoice/estimate/receipt, and photos of the damage.';
      case 'HEALTH':
        return 'Needed: claim form, itemised bill or receipt, and a medical report.';
      default:
        return '';
    }
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
    // Poll while the backend is reviewing, then stop.
    this.poll = timer(0, 3000)
      .pipe(
        switchMap(() => this.api.get(id)),
        takeWhile((c) => IN_FLIGHT.includes(c.status), true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (c) => this.claim.set(c),
        error: (err) => this.error.set(errorMessage(err)),
      });
  }

  upload(fileInput: HTMLInputElement) {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    this.error.set('');
    this.uploadProgress.set(0);
    this.api.upload(this.id(), this.docType, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress.set(Math.round((100 * event.loaded) / event.total));
        }
        if (event.type === HttpEventType.Response) {
          this.uploadProgress.set(null);
          this.load(this.id());
        }
      },
      error: (err) => {
        this.uploadProgress.set(null);
        this.error.set(errorMessage(err));
      },
    });
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.submit(this.id()));
      this.load(this.id());
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
