import { HttpErrorResponse } from '@angular/common/http';

/** Turns a Nest/Zod error response into one readable line. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const message = err.error?.message;
    if (Array.isArray(message)) {
      return message
        .map((m: { message?: string } | string) => (typeof m === 'string' ? m : m.message))
        .join('; ');
    }
    if (typeof message === 'string') return message;
    if (err.status === 0) return 'Cannot reach the server';
    return err.statusText || `Request failed (${err.status})`;
  }
  return 'Something went wrong';
}
