import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Role, User } from './models';

const STORAGE_KEY = 'claims.session';

interface Session {
  accessToken: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = signal<Session | null>(this.restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.accessToken ?? null);
  readonly isStaff = computed(() => {
    const role = this.user()?.role;
    return role === 'REVIEWER' || role === 'APPROVER' || role === 'ADMIN';
  });

  async login(email: string, password: string): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<Session>('/api/auth/login', { email, password }),
    );
    // sessionStorage: the token is gone when the tab closes. Use your IdP's SDK in production.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
    await this.router.navigateByUrl(this.homeFor(session.user.role));
  }

  logout(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    void this.router.navigateByUrl('/login');
  }

  hasRole(roles: Role[]): boolean {
    const role = this.user()?.role;
    return !!role && roles.includes(role);
  }

  homeFor(role: Role): string {
    switch (role) {
      case 'CLAIMANT':
        return '/my-claims';
      case 'APPROVER':
        return '/approvals';
      default:
        return '/queue';
    }
  }

  private restore(): Session | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }
}
