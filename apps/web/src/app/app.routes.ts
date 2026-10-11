import { Routes } from '@angular/router';
import { homeRedirect, roleGuard } from './core/guards';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then((m) => m.Login) },

  // Claimant
  {
    path: 'my-claims',
    canActivate: [roleGuard(['CLAIMANT'])],
    loadComponent: () => import('./features/claimant/my-claims').then((m) => m.MyClaims),
  },
  {
    path: 'my-claims/new',
    canActivate: [roleGuard(['CLAIMANT'])],
    loadComponent: () => import('./features/claimant/new-claim').then((m) => m.NewClaim),
  },
  {
    path: 'my-claims/:id',
    canActivate: [roleGuard(['CLAIMANT'])],
    loadComponent: () => import('./features/claimant/claimant-claim').then((m) => m.ClaimantClaim),
  },

  // Staff
  {
    path: 'queue',
    canActivate: [roleGuard(['REVIEWER', 'ADMIN'])],
    data: { mode: 'review' },
    loadComponent: () => import('./features/reviewer/queue').then((m) => m.Queue),
  },
  {
    path: 'approvals',
    canActivate: [roleGuard(['APPROVER', 'ADMIN'])],
    data: { mode: 'approve' },
    loadComponent: () => import('./features/reviewer/queue').then((m) => m.Queue),
  },
  {
    path: 'claims/:id',
    canActivate: [roleGuard(['REVIEWER', 'APPROVER', 'ADMIN'])],
    loadComponent: () => import('./features/reviewer/claim-review').then((m) => m.ClaimReview),
  },

  { path: '**', canActivate: [homeRedirect], children: [] },
];
