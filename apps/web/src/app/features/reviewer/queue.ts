import { CurrencyPipe, DatePipe, PercentPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ClaimsApiService, QueueFilter } from '../../core/claims-api.service';
import { ClaimSummary, Stats } from '../../core/models';
import { LabelPipe, RiskBadge, StatusChip } from '../../shared/ui';

interface StatusView {
  label: string;
  statuses: string;
}

const REVIEW_VIEWS: StatusView[] = [
  { label: 'Needs review', statuses: 'MANUAL_REVIEW,READY_FOR_APPROVAL' },
  { label: 'Flagged', statuses: 'MANUAL_REVIEW' },
  { label: 'Ready to approve', statuses: 'READY_FOR_APPROVAL' },
  { label: 'Waiting on claimant', statuses: 'PENDING_INFO' },
  { label: 'In progress', statuses: 'SUBMITTED,PROCESSING' },
  { label: 'Decided', statuses: 'PENDING_FINAL_APPROVAL,APPROVED,REJECTED' },
  { label: 'All', statuses: '' },
];
const APPROVE_VIEWS: StatusView[] = [
  { label: 'Awaiting final approval', statuses: 'PENDING_FINAL_APPROVAL' },
  { label: 'Decided', statuses: 'APPROVED,REJECTED' },
];

@Component({
  selector: 'app-queue',
  imports: [
    RouterLink,
    MatTableModule,
    MatCardModule,
    MatSelectModule,
    MatFormFieldModule,
    MatButtonToggleModule,
    MatPaginatorModule,
    MatIconModule,
    CurrencyPipe,
    DatePipe,
    PercentPipe,
    LabelPipe,
    StatusChip,
    RiskBadge,
  ],
  template: `
    <div class="page">
      <h1>{{ mode() === 'approve' ? 'Final approvals' : 'Review queue' }}</h1>

      @if (mode() === 'review' && stats(); as s) {
        <div class="tiles">
          <mat-card appearance="outlined"
            ><mat-card-content>
              <div class="tile-value">
                {{ (s.byStatus.MANUAL_REVIEW ?? 0) + (s.byStatus.READY_FOR_APPROVAL ?? 0) }}
              </div>
              <div class="muted">Awaiting review</div>
            </mat-card-content></mat-card
          >
          <mat-card appearance="outlined"
            ><mat-card-content>
              <div class="tile-value">{{ s.byStatus.MANUAL_REVIEW ?? 0 }}</div>
              <div class="muted">Flagged for manual review</div>
            </mat-card-content></mat-card
          >
          <mat-card appearance="outlined"
            ><mat-card-content>
              <div class="tile-value">
                {{ falsePositiveRate() === null ? '—' : (falsePositiveRate() | percent) }}
              </div>
              <div class="muted">AI findings marked false positive</div>
            </mat-card-content></mat-card
          >
          <mat-card appearance="outlined"
            ><mat-card-content>
              <div class="tile-value">
                {{ s.reviewerDecisions ? (s.aiOverrides / s.reviewerDecisions | percent) : '—' }}
              </div>
              <div class="muted">Reviewer overrode AI recommendation</div>
            </mat-card-content></mat-card
          >
        </div>
      }

      <div class="row filters">
        <mat-button-toggle-group
          [value]="view()"
          (change)="view.set($event.value); page.set(0)"
          hideSingleSelectionIndicator
        >
          @for (v of views(); track v.label) {
            <mat-button-toggle [value]="v">{{ v.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
        <span class="spacer"></span>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Sort by</mat-label>
          <mat-select [value]="sort()" (selectionChange)="sort.set($event.value)">
            <mat-option value="risk">Highest risk first</mat-option>
            <mat-option value="amount">Largest amount first</mat-option>
            <mat-option value="submitted">Oldest first</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <mat-card appearance="outlined">
        <table mat-table [dataSource]="items()">
          <ng-container matColumnDef="risk">
            <th mat-header-cell *matHeaderCellDef>Risk</th>
            <td mat-cell *matCellDef="let c"><app-risk-badge [score]="c.riskScore" /></td>
          </ng-container>
          <ng-container matColumnDef="claimNumber">
            <th mat-header-cell *matHeaderCellDef>Claim</th>
            <td mat-cell *matCellDef="let c">
              <strong>{{ c.claimNumber }}</strong>
              <div class="muted small">{{ c.lineOfBusiness | label }} · {{ c.policyNumber }}</div>
            </td>
          </ng-container>
          <ng-container matColumnDef="claimant">
            <th mat-header-cell *matHeaderCellDef>Claimant</th>
            <td mat-cell *matCellDef="let c">{{ c.claimantName }}</td>
          </ng-container>
          <ng-container matColumnDef="amount">
            <th mat-header-cell *matHeaderCellDef>Amount</th>
            <td mat-cell *matCellDef="let c">{{ c.amountClaimed | currency }}</td>
          </ng-container>
          <ng-container matColumnDef="findings">
            <th mat-header-cell *matHeaderCellDef>Findings</th>
            <td mat-cell *matCellDef="let c">
              @if (c.highFindings) {
                <span class="high"
                  ><mat-icon inline>error</mat-icon> {{ c.highFindings }} high</span
                >
              }
              <span class="muted"> {{ c.totalFindings }} total</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="submitted">
            <th mat-header-cell *matHeaderCellDef>Submitted</th>
            <td mat-cell *matCellDef="let c">{{ c.submittedAt | date: 'short' }}</td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let c"><app-status-chip [status]="c.status" /></td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr
            mat-row
            *matRowDef="let row; columns: columns"
            class="clickable"
            [routerLink]="['/claims', row.id]"
          ></tr>
          <tr class="mat-row" *matNoDataRow>
            <td class="mat-cell empty muted" [attr.colspan]="columns.length">
              No claims in this view.
            </td>
          </tr>
        </table>
        <mat-paginator
          [length]="total()"
          [pageIndex]="page()"
          [pageSize]="pageSize"
          [hidePageSize]="true"
          (page)="onPage($event)"
        />
      </mat-card>
    </div>
  `,
  styles: `
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .tile-value {
      font: var(--mat-sys-headline-medium);
    }
    .filters {
      margin-bottom: 12px;
    }
    .clickable {
      cursor: pointer;
    }
    .clickable:hover {
      background: var(--mat-sys-surface-container);
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .high {
      color: #b3261e;
      font-weight: 500;
    }
    .empty {
      padding: 24px;
      text-align: center;
    }
  `,
})
export class Queue {
  /** Bound from route data. */
  readonly mode = input<'review' | 'approve'>('review');

  private readonly api = inject(ClaimsApiService);
  protected readonly columns = [
    'risk',
    'claimNumber',
    'claimant',
    'amount',
    'findings',
    'submitted',
    'status',
  ];
  protected readonly pageSize = 25;

  protected readonly views = computed(() =>
    this.mode() === 'approve' ? APPROVE_VIEWS : REVIEW_VIEWS,
  );
  protected readonly view = signal<StatusView>(REVIEW_VIEWS[0]);
  protected readonly sort = signal<NonNullable<QueueFilter['sort']>>('risk');
  protected readonly page = signal(0);
  protected readonly items = signal<ClaimSummary[]>([]);
  protected readonly total = signal(0);

  protected readonly stats = toSignal(this.api.stats().pipe(catchError(() => of(undefined))));
  protected readonly falsePositiveRate = computed(() => falsePositiveRate(this.stats()));

  constructor() {
    effect(() => this.view.set(this.views()[0]));
    effect((onCleanup) => {
      const filter = {
        status: this.view().statuses,
        sort: this.sort(),
        page: this.page(),
        pageSize: this.pageSize,
      };
      const sub = untracked(() =>
        this.api.list(filter).subscribe({
          next: (page) => {
            this.items.set(page.items);
            this.total.set(page.total);
          },
          error: () => this.items.set([]),
        }),
      );
      onCleanup(() => sub.unsubscribe());
    });
  }

  onPage(event: PageEvent) {
    this.page.set(event.pageIndex);
  }
}

function falsePositiveRate(stats: Stats | undefined): number | null {
  const ai = stats?.findingVerdicts.filter((v) => v.source === 'AI') ?? [];
  const total = ai.reduce((sum, v) => sum + v.count, 0);
  if (!total) return null;
  return (
    ai.filter((v) => v.verdict === 'FALSE_POSITIVE').reduce((sum, v) => sum + v.count, 0) / total
  );
}
