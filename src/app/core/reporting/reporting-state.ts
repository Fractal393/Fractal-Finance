import { Injectable, signal, inject } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import {
  DashboardReport,
  ReportingPeriodType,
} from './reporting-models';

@Injectable({
  providedIn: 'root',
})
export class ReportingState {
  private readonly api = inject(ApiClientService);

  readonly report = signal<DashboardReport | null>(null);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly currentPeriod = signal<ReportingPeriodType>('current_month');
  readonly customStartDate = signal<string>('');
  readonly customEndDate = signal<string>('');

  /**
   * Fetches the complete canonical dashboard report for the specified period.
   */
  async loadReport(
    period?: ReportingPeriodType,
    customStart?: string,
    customEnd?: string,
  ): Promise<void> {
    const selectedPeriod = period || this.currentPeriod();
    this.currentPeriod.set(selectedPeriod);

    if (customStart !== undefined) this.customStartDate.set(customStart);
    if (customEnd !== undefined) this.customEndDate.set(customEnd);

    this.loading.set(true);
    this.error.set(null);

    try {
      const queryParams: Record<string, string> = {
        period: selectedPeriod,
      };

      if (selectedPeriod === 'custom') {
        const start = this.customStartDate();
        const end = this.customEndDate();
        if (start) queryParams['startDate'] = start;
        if (end) queryParams['endDate'] = end;
      }

      const queryString = new URLSearchParams(queryParams).toString();
      const endpoint = `/api/reports/dashboard${queryString ? `?${queryString}` : ''}`;

      const data = await this.api.get<DashboardReport>(endpoint);
      this.report.set(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard report';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Quick refresh of the current report (e.g. after adding or editing transactions).
   */
  async refresh(): Promise<void> {
    return this.loadReport(this.currentPeriod());
  }
}
