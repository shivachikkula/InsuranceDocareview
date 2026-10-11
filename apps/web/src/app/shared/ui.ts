import { Component, computed, input, Pipe, PipeTransform } from '@angular/core';
import { ClaimStatus, Severity } from '../core/models';

/** CLAIM_FORM -> "Claim form" */
@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const text = value.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}

@Component({
  selector: 'app-status-chip',
  imports: [LabelPipe],
  template: `<span class="chip status-{{ status() }}">{{ status() | label }}</span>`,
  styleUrl: './chip.scss',
})
export class StatusChip {
  readonly status = input.required<ClaimStatus>();
}

@Component({
  selector: 'app-severity-chip',
  template: `<span class="chip sev-{{ severity() }}">{{ severity() }}</span>`,
  styleUrl: './chip.scss',
})
export class SeverityChip {
  readonly severity = input.required<Severity>();
}

@Component({
  selector: 'app-risk-badge',
  template: `
    @if (score() === null || score() === undefined) {
      <span class="chip muted-chip" title="No AI risk score">—</span>
    } @else {
      <span class="chip sev-{{ level() }}" [title]="'AI risk score ' + score()">{{ score() }}</span>
    }
  `,
  styleUrl: './chip.scss',
})
export class RiskBadge {
  readonly score = input<number | null | undefined>();
  readonly level = computed<Severity>(() => {
    const s = this.score() ?? 0;
    return s >= 60 ? 'HIGH' : s >= 30 ? 'MEDIUM' : 'LOW';
  });
}
