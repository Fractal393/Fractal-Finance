import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-investments-placeholder',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 select-none">
      <div class="border-b border-[var(--color-border)] pb-6">
        <span class="text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">Portfolio Allocation</span>
        <h2 class="font-editorial text-3xl font-semibold text-[var(--color-ink)] mt-1">
          Investments
        </h2>
        <p class="text-sm text-[var(--color-secondary)] mt-1">
          Aggregate investment categories, periodic valuations, and capital performance.
        </p>
      </div>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 text-center max-w-xl mx-auto space-y-4">
        <div class="w-12 h-12 mx-auto rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center">
          <mat-icon class="text-[24px] w-6 h-6 text-[var(--color-secondary)]">trending_up</mat-icon>
        </div>
        <h3 class="font-editorial text-xl font-semibold text-[var(--color-ink)]">
          Investments Engine Scheduled for Slice 2
        </h3>
        <p class="text-xs text-[var(--color-secondary)] leading-relaxed">
          Aggregate positions (Equity, Mutual Funds, Fixed Deposits, Gold, NPS) and periodic valuation records will be implemented in subsequent slices. Per financial rules, investment contributions are recognized as allocations of savings, not expenses.
        </p>
      </div>
    </div>
  `,
})
export class InvestmentsPlaceholder {}
