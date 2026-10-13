import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

/** UI-only guard. The API enforces the same roles on every endpoint. */
export const roleGuard =
  (roles: Role[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const user = auth.user();
    if (!user) return router.parseUrl('/login');
    return roles.includes(user.role) ? true : router.parseUrl(auth.homeFor(user.role));
  };

export const homeRedirect: CanActivateFn = () => {
  const auth = inject(AuthService);
  const user = auth.user();
  return inject(Router).parseUrl(user ? auth.homeFor(user.role) : '/login');
};
