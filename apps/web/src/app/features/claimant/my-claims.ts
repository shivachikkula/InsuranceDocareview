import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ClaimsApiService } from '../../core/claims-api.service';
import { ClaimantStatusPipe } from './claimant-status';

@Component({
  selector: 'app-my-claims',
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    RouterLink,
    CurrencyPipe,
    DatePipe,
    ClaimantStatusPipe,
  ],
  template: `
    <div class="page">
      <div class="row">
        <h1>My claims</h1>
        <span class="spacer"></span>
        <a mat-flat-button routerLink="/my-claims/new"><mat-icon>add</mat-icon> New claim</a>
      </div>
      <mat-card appearance="outlined">
        @if (claims(); as claims) {
          @if (claims.length === 0) {
            <mat-card-content class="muted">You have not filed any claims yet.</mat-card-content>
          } @else {
            <table mat-table [dataSource]="claims">
              <ng-container matColumnDef="claimNumber">
                <th mat-header-cell *matHeaderCellDef>Claim</th>
                <td mat-cell *matCellDef="let c">{{ c.claimNumber }}</td>
              </ng-container>
              <ng-container matColumnDef="policy">
                <th mat-header-cell *matHeaderCellDef>Policy</th>
                <td mat-cell *matCellDef="let c">{{ c.policyNumber }}</td>
              </ng-container>
              <ng-container matColumnDef="incidentDate">
                <th mat-header-cell *matHeaderCellDef>Incident</th>
                <td mat-cell *matCellDef="let c">
                  {{ c.incidentDate | date: 'mediumDate' : 'UTC' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="amount">
                <th mat-header-cell *matHeaderCellDef>Amount</th>
                <td mat-cell *matCellDef="let c">{{ c.amountClaimed | currency }}</td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let c">{{ c.status | claimantStatus }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                *matRowDef="let row; columns: columns"
                class="clickable"
                [routerLink]="['/my-claims', row.id]"
              ></tr>
            </table>
          }
        }
      </mat-card>
    </div>
  `,
  styles: `
    .clickable {
      cursor: pointer;
    }
    .clickable:hover {
      background: var(--mat-sys-surface-container);
    }
  `,
})
export class MyClaims {
  protected readonly columns = ['claimNumber', 'policy', 'incidentDate', 'amount', 'status'];
  protected readonly claims = toSignal(
    inject(ClaimsApiService)
      .list({ pageSize: 100 })
      .pipe(map((page) => page.items)),
  );
}
