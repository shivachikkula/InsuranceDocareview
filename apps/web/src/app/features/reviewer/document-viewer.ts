import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ClaimsApiService } from '../../core/claims-api.service';
import { ClaimDocument } from '../../core/models';

/**
 * Shows one claim document. Files are fetched through HttpClient so the auth
 * header is sent, then displayed from a local blob: URL.
 */
@Component({
  selector: 'app-document-viewer',
  imports: [MatIconModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (url(); as url) {
      @switch (kind()) {
        @case ('pdf') {
          <iframe [src]="url" title="Document preview"></iframe>
        }
        @case ('image') {
          <div class="image"><img [src]="url" [alt]="document().fileName" /></div>
        }
        @case ('text') {
          <pre>{{ text() }}</pre>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: #fff;
    }
    .image {
      flex: 1;
      overflow: auto;
      display: grid;
      place-items: center;
      background: #222;
    }
    img {
      max-width: 100%;
    }
    pre {
      flex: 1;
      overflow: auto;
      margin: 0;
      padding: 16px;
      white-space: pre-wrap;
      background: #fff;
    }
    .error {
      color: var(--mat-sys-error);
      padding: 16px;
    }
  `,
})
export class DocumentViewer {
  readonly claimId = input.required<string>();
  readonly document = input.required<ClaimDocument>();
  /** 1-based PDF page to open at. */
  readonly page = input<number | null>(null);

  private readonly api = inject(ClaimsApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private objectUrl: string | null = null;

  protected readonly url = signal<SafeResourceUrl | null>(null);
  protected readonly kind = signal<'pdf' | 'image' | 'text'>('pdf');
  protected readonly text = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revoke());

    effect((onCleanup) => {
      const doc = this.document();
      const claimId = this.claimId();
      this.loading.set(true);
      this.error.set('');
      const sub = untracked(() =>
        this.api.documentBlob(claimId, doc.id).subscribe({
          next: async (blob) => {
            this.revoke();
            this.objectUrl = URL.createObjectURL(blob);
            this.kind.set(
              doc.mimeType === 'application/pdf'
                ? 'pdf'
                : doc.mimeType.startsWith('image/')
                  ? 'image'
                  : 'text',
            );
            if (this.kind() === 'text') this.text.set(await blob.text());
            this.render();
            this.loading.set(false);
          },
          error: () => {
            this.error.set('Could not load document');
            this.loading.set(false);
          },
        }),
      );
      onCleanup(() => sub.unsubscribe());
    });

    // Jump to the cited page without refetching the file.
    effect(() => {
      this.page();
      this.render();
    });
  }

  private render() {
    if (!this.objectUrl) return;
    const page = this.page();
    const src = this.kind() === 'pdf' && page ? `${this.objectUrl}#page=${page}` : this.objectUrl;
    // Safe: the URL is a blob: URL we created from our own API response.
    this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(src));
  }

  private revoke() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
