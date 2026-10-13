import { Pipe, PipeTransform } from '@angular/core';
import { ClaimStatus } from '../../core/models';

/** Claimants see plain-language statuses, not internal review stages. */
@Pipe({ name: 'claimantStatus' })
export class ClaimantStatusPipe implements PipeTransform {
  transform(status: ClaimStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'Draft – not submitted';
      case 'SUBMITTED':
      case 'PROCESSING':
        return 'Received';
      case 'PENDING_INFO':
        return 'Action needed: more information';
      case 'MANUAL_REVIEW':
      case 'READY_FOR_APPROVAL':
      case 'PENDING_FINAL_APPROVAL':
        return 'Under review';
      case 'APPROVED':
        return 'Approved';
      case 'REJECTED':
        return 'Declined';
    }
  }
}
