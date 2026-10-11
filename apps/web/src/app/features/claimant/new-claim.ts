import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClaimsApiService } from '../../core/claims-api.service';
import { errorMessage } from '../../core/errors';
import { LabelPipe } from '../../shared/ui';

@Component({
  selector: 'app-new-claim',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    RouterLink,
    CurrencyPipe,
    LabelPipe,
  ],
  template: `
    <div class="page narrow">
      <h1>New claim</h1>
      <mat-card appearance="outlined">
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="save()">
            <mat-form-field class="full-width">
              <mat-label>Policy</mat-label>
              <mat-select formControlName="policyId">
                @for (p of policies(); track p.id) {
                  <mat-option [value]="p.id">
                    {{ p.policyNumber }} · {{ p.lineOfBusiness | label }}
                    @if (p.status !== 'ACTIVE') {
                      ({{ p.status | label }})
                    }
                  </mat-option>
                }
              </mat-select>
              @if (selectedPolicy(); as p) {
                <mat-hint
                  >Limit {{ p.coverageLimit | currency }} · deductible
                  {{ p.deductible | currency }}</mat-hint
                >
              }
            </mat-form-field>

            <div class="row">
              <mat-form-field>
                <mat-label>Date of incident</mat-label>
                <input matInput type="date" formControlName="incidentDate" [max]="today" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Amount claimed (USD)</mat-label>
                <input matInput type="number" min="1" step="0.01" formControlName="amountClaimed" />
              </mat-form-field>
            </div>

            <mat-form-field class="full-width">
              <mat-label>Repair shop / provider (optional)</mat-label>
              <input matInput formControlName="providerName" />
            </mat-form-field>

            <mat-form-field class="full-width">
              <mat-label>What happened?</mat-label>
              <textarea matInput rows="5" formControlName="description"></textarea>
              <mat-hint>At least 20 characters. Include where and how it happened.</mat-hint>
            </mat-form-field>

            @if (error()) {
              <p class="error">{{ error() }}</p>
            }
            <div class="row actions">
              <a mat-button routerLink="/my-claims">Cancel</a>
              <span class="spacer"></span>
              <button mat-flat-button [disabled]="form.invalid || busy()">
                Continue to documents
              </button>
            </div>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .narrow {
      max-width: 720px;
    }
    .row mat-form-field {
      flex: 1;
      min-width: 200px;
    }
    .actions {
      margin-top: 16px;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class NewClaim {
  private readonly api = inject(ClaimsApiService);
  private readonly router = inject(Router);

  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly policies = toSignal(this.api.myPolicies(), { initialValue: [] });
  protected readonly form = inject(FormBuilder).nonNullable.group({
    policyId: ['', Validators.required],
    incidentDate: ['', Validators.required],
    amountClaimed: [null as number | null, [Validators.required, Validators.min(1)]],
    providerName: [''],
    description: ['', [Validators.required, Validators.minLength(20)]],
  });
  private readonly policyId = toSignal(this.form.controls.policyId.valueChanges, {
    initialValue: '',
  });
  protected readonly selectedPolicy = computed(() =>
    this.policies().find((p) => p.id === this.policyId()),
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const v = this.form.getRawValue();
      const claim = await firstValueFrom(
        this.api.create({
          policyId: v.policyId,
          incidentDate: v.incidentDate,
          amountClaimed: Number(v.amountClaimed),
          description: v.description,
          providerName: v.providerName || undefined,
        }),
      );
      await this.router.navigate(['/my-claims', claim.id]);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
