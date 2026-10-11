import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>Sign in</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field class="full-width">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email" autocomplete="username" />
            </mat-form-field>
            <mat-form-field class="full-width">
              <mat-label>Password</mat-label>
              <input
                matInput
                formControlName="password"
                type="password"
                autocomplete="current-password"
              />
            </mat-form-field>
            @if (error()) {
              <p class="error">{{ error() }}</p>
            }
            <button mat-flat-button class="full-width" [disabled]="form.invalid || busy()">
              Sign in
            </button>
          </form>
          <p class="muted demo">
            Demo users (password <code>Password123!</code>):<br />
            alice&#64;example.com (claimant) · rita&#64;insurer.example (reviewer) ·
            anna&#64;insurer.example (approver)
          </p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 16px;
    }
    mat-card {
      width: min(420px, 100%);
    }
    form {
      margin-top: 16px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .demo {
      font: var(--mat-sys-body-small);
      margin-top: 16px;
    }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
