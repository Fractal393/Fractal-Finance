import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ReportingState } from '../../core/reporting/reporting-state';
import { ReportingPeriodType, formatPrettyDate } from '../../core/reporting/reporting-models';
import { formatMinorUnits } from '../../core/accounts/account-models';
import { QuickAddService } from '../../core/transactions/quick-add.service';

interface PeriodOption {
  type: ReportingPeriodType;
  label: string;
  shortLabel: string;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-8 select-none antialiased pb-16">
      <!-- A. Header -->
      <div class="border-b border-[var(--color-border)] pb-6 space-y-4">
        <!-- Title & Freshness Row -->
        <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-2 text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">
              <span>Financial Overview</span>
              <span aria-hidden="true">·</span>
              <span class="text-[var(--color-accent)] font-semibold">Canonical Reporting</span>
            </div>
            <h1 class="font-editorial text-3xl md:text-4xl font-semibold text-[var(--color-ink)] mt-1">
              Home
            </h1>
            <p class="text-xs md:text-sm text-[var(--color-secondary)] mt-1 max-w-2xl">
              Derived from canonical financial records. Historical transactions accurately reconstruct financial position over time.
            </p>
          </div>

          <!-- Real Account Sync Status & Quick Refresh -->
          <div class="flex items-center space-x-3 text-xs text-[var(--color-secondary)]">
            @if (reportingState.report(); as rep) {
              <span class="inline-flex items-center space-x-1.5" [title]="rep.syncStatus.details">
                <span
                  class="w-2 h-2 rounded-full"
                  [class.bg-[var(--color-positive)]]="rep.syncStatus.isFullyReconciled"
                  [class.bg-[#A8752F]]="!rep.syncStatus.isFullyReconciled && rep.syncStatus.reconciledAccountsCount > 0"
                  [class.bg-[var(--color-secondary)]]="rep.syncStatus.reconciledAccountsCount === 0"
                ></span>
                <span class="font-medium text-[var(--color-ink)]">{{ rep.syncStatus.statusLabel }}</span>
              </span>
            } @else {
              <span class="inline-flex items-center space-x-1.5">
                <span class="w-2 h-2 rounded-full bg-[var(--color-secondary)]"></span>
                <span>Connecting to ledger...</span>
              </span>
            }
            <button
              type="button"
              (click)="refreshDashboard()"
              [disabled]="reportingState.loading()"
              class="px-2.5 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-ink)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer inline-flex items-center space-x-1 disabled:opacity-50"
              title="Refresh ledger data"
            >
              <mat-icon class="text-[14px] w-3.5 h-3.5" [class.animate-spin]="reportingState.loading()">sync</mat-icon>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <!-- Reporting Period Selector & Resolved Range -->
        <div class="pt-2 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <!-- 5 Canonical Reporting Periods (No Quarter, No Invented Names) -->
          <div class="inline-flex flex-wrap items-center p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl gap-1">
            @for (opt of periodOptions; track opt.type) {
              <button
                type="button"
                (click)="selectPeriod(opt.type)"
                [class.bg-[var(--color-canvas)]]="reportingState.currentPeriod() === opt.type"
                [class.text-[var(--color-ink)]]="reportingState.currentPeriod() === opt.type"
                [class.font-semibold]="reportingState.currentPeriod() === opt.type"
                [class.shadow-xs]="reportingState.currentPeriod() === opt.type"
                [class.text-[var(--color-secondary)]]="reportingState.currentPeriod() !== opt.type"
                class="px-3 py-1.5 rounded-lg text-xs tracking-wide transition-all hover:text-[var(--color-ink)] cursor-pointer"
              >
                <span class="hidden sm:inline">{{ opt.label }}</span>
                <span class="sm:hidden">{{ opt.shortLabel }}</span>
              </button>
            }
          </div>

          <!-- Resolved Date Range Label -->
          <div class="text-xs font-mono text-[var(--color-secondary)] flex items-center space-x-2">
            <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-accent)]">date_range</mat-icon>
            <span class="font-medium text-[var(--color-ink)]">
              {{ reportingState.report()?.period?.label || 'Loading period...' }}
            </span>
          </div>
        </div>

        <!-- Custom Date Range Form (Visible only when 'custom' is active) -->
        @if (reportingState.currentPeriod() === 'custom') {
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-wrap items-end gap-4 text-xs">
            <form [formGroup]="customRangeForm" (ngSubmit)="applyCustomRange()" class="flex flex-wrap items-end gap-3 w-full">
              <div>
                <label for="rep-start" class="block font-mono uppercase text-[11px] text-[var(--color-secondary)] mb-1">
                  Start Date
                </label>
                <input
                  id="rep-start"
                  type="date"
                  formControlName="startDate"
                  class="px-3 py-1.5 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] text-xs text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <div>
                <label for="rep-end" class="block font-mono uppercase text-[11px] text-[var(--color-secondary)] mb-1">
                  End Date
                </label>
                <input
                  id="rep-end"
                  type="date"
                  formControlName="endDate"
                  class="px-3 py-1.5 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] text-xs text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <button
                type="submit"
                [disabled]="customRangeForm.invalid || reportingState.loading()"
                class="px-4 py-1.5 rounded-lg bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer disabled:opacity-50"
              >
                Apply Range
              </button>
            </form>
          </div>
        }
      </div>

      <!-- Loading / Error States -->
      @if (reportingState.loading() && !reportingState.report()) {
        <div class="p-12 text-center text-xs text-[var(--color-secondary)] space-y-3">
          <mat-icon class="text-[32px] w-8 h-8 text-[var(--color-accent)] animate-spin mx-auto">sync</mat-icon>
          <p>Recomputing canonical financial reports across transaction ledger...</p>
        </div>
      } @else if (reportingState.error()) {
        <div class="p-6 bg-[#B24C4C]/10 border border-[#B24C4C]/20 rounded-xl text-xs text-[#B24C4C] space-y-2">
          <div class="flex items-center space-x-2 font-semibold">
            <mat-icon class="text-[18px] w-[18px] h-[18px]">error_outline</mat-icon>
            <span>Failed to load financial reporting data</span>
          </div>
          <p>{{ reportingState.error() }}</p>
          <button
            type="button"
            (click)="refreshDashboard()"
            class="px-3 py-1 rounded bg-[var(--color-surface)] text-[var(--color-ink)] font-medium border border-[var(--color-border)] hover:bg-[var(--color-canvas)] cursor-pointer mt-2"
          >
            Retry
          </button>
        </div>
      } @else if (reportingState.report(); as rep) {
        <!-- 1. NET WORTH HERO (TRUTHFULLY RECONSTRUCTED AS OF EFFECTIVE DATE) -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 md:p-8 space-y-6">
          <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div class="flex items-center space-x-2 text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">
                <span>Primary Financial Position</span>
                <span aria-hidden="true">·</span>
                @if (rep.netWorth.isHistoricalReconstruction) {
                  <span class="text-[var(--color-accent)] font-semibold">
                    Reconstructed as of {{ prettyDate(rep.netWorth.asOfDate) }}
                  </span>
                } @else {
                  <span>Current Ledger Balance</span>
                }
              </div>
              <h2 class="text-xs font-medium text-[var(--color-secondary)] mt-1 uppercase tracking-wider">
                Total Net Worth
              </h2>
              <div class="flex flex-wrap items-baseline gap-3 mt-1">
                <span class="font-editorial text-4xl md:text-5xl font-semibold tracking-tight text-[var(--color-ink)] tabular-nums">
                  {{ formatCurrency(rep.netWorth.totalNetWorth) }}
                </span>
                @if (rep.netWorth.isHistoricalReconstruction) {
                  <span class="text-xs font-mono text-[var(--color-secondary)]">
                    (Current Today: {{ formatCurrency(rep.netWorth.currentCashPosition) }})
                  </span>
                }
              </div>
              <p class="text-xs text-[var(--color-secondary)] mt-2 italic">
                {{ rep.netWorth.disclaimer }}
              </p>
            </div>

            <!-- Quick Add Action on Desktop -->
            <button
              type="button"
              (click)="quickAdd.open()"
              class="hidden sm:inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-[var(--color-accent)] text-white text-xs font-medium hover:bg-[var(--color-accent-hover)] transition-all cursor-pointer shadow-xs"
            >
              <mat-icon class="text-[18px] w-[18px] h-[18px]">add</mat-icon>
              <span>Record Transaction</span>
            </button>
          </div>

          <!-- Truthful Net Worth Breakdown -->
          <div class="pt-4 border-t border-[var(--color-border)] grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <!-- Liquid Financial Assets -->
            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[11px] uppercase tracking-wider text-[var(--color-secondary)] block">Financial Assets (Cash & Bank)</span>
              <span class="font-mono text-base font-semibold text-[var(--color-ink)] tabular-nums mt-0.5 block">
                {{ formatCurrency(rep.netWorth.cashPosition) }}
              </span>
              <span class="text-[10px] text-[var(--color-positive)] font-medium mt-1 inline-flex items-center">
                <mat-icon class="text-[12px] w-3 h-3 mr-0.5">check_circle</mat-icon>
                Reconstructed as of {{ prettyDate(rep.netWorth.asOfDate) }}
              </span>
            </div>

            <!-- Non-Financial Assets -->
            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[11px] uppercase tracking-wider text-[var(--color-secondary)] block">Non-Financial Assets</span>
              <span class="font-mono text-base font-semibold text-[var(--color-secondary)] tabular-nums mt-0.5 block">
                —
              </span>
              <span class="text-[10px] text-[var(--color-secondary)] font-medium mt-1 inline-flex items-center">
                <mat-icon class="text-[12px] w-3 h-3 mr-0.5 text-[var(--color-secondary)]">hourglass_empty</mat-icon>
                Not yet tracked in Slice 4
              </span>
            </div>

            <!-- Liabilities (Truthfully derived from DEBT_BORROWING - DEBT_REPAYMENT) -->
            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[11px] uppercase tracking-wider text-[var(--color-secondary)] block">Recorded Liabilities</span>
              <span
                class="font-mono text-base font-semibold tabular-nums mt-0.5 block"
                [class.text-[#B24C4C]]="rep.netWorth.liabilities > 0"
                [class.text-[var(--color-ink)]]="rep.netWorth.liabilities === 0"
              >
                {{ formatCurrency(rep.netWorth.liabilities) }}
              </span>
              <span
                class="text-[10px] font-medium mt-1 inline-flex items-center"
                [class.text-[#B24C4C]]="rep.netWorth.liabilities > 0"
                [class.text-[var(--color-secondary)]]="rep.netWorth.liabilities === 0"
              >
                <mat-icon class="text-[12px] w-3 h-3 mr-0.5">{{ rep.netWorth.liabilities > 0 ? 'warning' : 'info_outline' }}</mat-icon>
                {{ rep.netWorth.liabilities > 0 ? 'Active debt from ledger' : 'Zero debt recorded in ledger' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 2. CURRENT FINANCIAL METRICS (SELECTED PERIOD) -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-editorial text-xl font-semibold text-[var(--color-ink)]">
              Period Financial Activity
            </h3>
            <span class="text-xs font-mono text-[var(--color-secondary)]">
              {{ rep.period.label }}
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Metric 1: Cash Position -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-2">
              <div class="flex items-center justify-between text-[var(--color-secondary)]">
                <span class="text-xs font-mono uppercase tracking-wider">Cash Position</span>
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-accent)]">account_balance_wallet</mat-icon>
              </div>
              <div class="font-mono text-xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ formatCurrency(rep.netWorth.cashPosition) }}
              </div>
              <div class="text-[11px] text-[var(--color-secondary)] pt-1 border-t border-[var(--color-border)]/40 flex justify-between">
                <span>Bank: {{ formatCurrency(rep.composition.bankAccountsTotal) }}</span>
                <span>Cash: {{ formatCurrency(rep.composition.cashAccountsTotal) }}</span>
              </div>
            </div>

            <!-- Metric 2: Gross Income -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-2">
              <div class="flex items-center justify-between text-[var(--color-secondary)]">
                <span class="text-xs font-mono uppercase tracking-wider">Income</span>
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-positive)]">arrow_downward</mat-icon>
              </div>
              <div class="font-mono text-xl font-bold text-[var(--color-positive)] tabular-nums">
                +{{ formatCurrency(rep.periodMetrics.grossIncome) }}
              </div>
              <div class="text-[11px] text-[var(--color-secondary)] pt-1 border-t border-[var(--color-border)]/40">
                Posted income transactions
              </div>
            </div>

            <!-- Metric 3: Net Tax Paid -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-2">
              <div class="flex items-center justify-between text-[var(--color-secondary)]">
                <span class="text-xs font-mono uppercase tracking-wider">Net Tax Paid</span>
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[#A8752F]">receipt</mat-icon>
              </div>
              <div class="font-mono text-xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ formatCurrency(rep.periodMetrics.netTaxPaid) }}
              </div>
              <div class="text-[11px] text-[var(--color-secondary)] pt-1 border-t border-[var(--color-border)]/40">
                Direct tax cash outflows
              </div>
            </div>

            <!-- Metric 4: Total Expenses -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-2">
              <div class="flex items-center justify-between text-[var(--color-secondary)]">
                <span class="text-xs font-mono uppercase tracking-wider">Total Expenses</span>
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[#B24C4C]">arrow_upward</mat-icon>
              </div>
              <div class="font-mono text-xl font-bold text-[#B24C4C] tabular-nums">
                -{{ formatCurrency(rep.periodMetrics.totalExpenses) }}
              </div>
              <div class="text-[11px] text-[var(--color-secondary)] pt-1 border-t border-[var(--color-border)]/40 flex justify-between">
                <span>Consumption: {{ formatCurrency(rep.periodMetrics.consumptionExpenses) }}</span>
                @if (rep.periodMetrics.nonFinancialAssetPurchases > 0) {
                  <span>Assets: {{ formatCurrency(rep.periodMetrics.nonFinancialAssetPurchases) }}</span>
                }
              </div>
            </div>
          </div>

          <!-- Savings & Savings Rate Highlight Row -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Savings Card -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 md:col-span-2 space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">Savings</span>
                  <div class="flex items-baseline space-x-2 mt-1">
                    <span
                      class="font-editorial text-3xl font-bold tabular-nums"
                      [class.text-[var(--color-positive)]]="rep.periodMetrics.savings >= 0"
                      [class.text-[#B24C4C]]="rep.periodMetrics.savings < 0"
                    >
                      {{ rep.periodMetrics.savings >= 0 ? '+' : '' }}{{ formatCurrency(rep.periodMetrics.savings) }}
                    </span>
                  </div>
                </div>

                <!-- Savings Rate Indicator -->
                <div class="text-right">
                  <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] block">Savings Rate</span>
                  <span class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums mt-0.5 block">
                    {{ rep.periodMetrics.savingsRate !== null ? (rep.periodMetrics.savingsRate + '%') : '—' }}
                  </span>
                </div>
              </div>

              <!-- Mathematical Transparency Breakdown -->
              <div class="p-3 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)]/60 text-xs font-mono text-[var(--color-secondary)] space-y-1">
                <div class="text-[11px] uppercase tracking-wider text-[var(--color-ink)] font-semibold font-sans">
                  Formula: Savings = Net Income - Total Expenses
                </div>
                <div class="flex flex-wrap items-center gap-x-2">
                  <span>Gross Income: {{ formatCurrency(rep.periodMetrics.grossIncome) }}</span>
                  <span aria-hidden="true">-</span>
                  <span>Taxes: {{ formatCurrency(rep.periodMetrics.netTaxPaid) }}</span>
                  <span aria-hidden="true">=</span>
                  <span class="text-[var(--color-ink)]">Net Income: {{ formatCurrency(rep.periodMetrics.netIncome) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-x-2">
                  <span>Net Income: {{ formatCurrency(rep.periodMetrics.netIncome) }}</span>
                  <span aria-hidden="true">-</span>
                  <span>Total Expenses: {{ formatCurrency(rep.periodMetrics.totalExpenses) }}</span>
                  <span aria-hidden="true">=</span>
                  <span class="font-semibold text-[var(--color-ink)]">Savings: {{ formatCurrency(rep.periodMetrics.savings) }}</span>
                </div>
              </div>
            </div>

            <!-- Investment Allocation Notice Card -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-3">
              <div class="flex items-center justify-between text-[var(--color-secondary)]">
                <span class="text-xs font-mono uppercase tracking-wider">Investment Allocation</span>
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-accent)]">trending_up</mat-icon>
              </div>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ formatCurrency(rep.periodMetrics.investmentAllocation) }}
              </div>
              <div class="space-y-1 text-xs text-[var(--color-secondary)]">
                <p class="text-[11px] leading-relaxed">
                  Money allocated from savings into investment accounts. <strong>Not an expense</strong> and not subtracted from savings.
                </p>
                <div class="pt-2 border-t border-[var(--color-border)]/40 font-mono text-[11px] flex justify-between text-[var(--color-ink)]">
                  <span>Retained Cash:</span>
                  <span class="font-semibold">{{ formatCurrency(rep.periodMetrics.cashRetained) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. CASH FLOW & INTERNAL TRANSFERS -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Cash Flow Visualization -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 lg:col-span-2 space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                  Cash Flow Movement
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Complete liquidity flows in and out of accounts during the selected period.
                </p>
              </div>
              <span class="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-secondary)]">
                Period View
              </span>
            </div>

            <!-- Flow Bars / Numbers -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
                <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] block">Total Inflows</span>
                <span class="font-mono text-lg font-bold text-[var(--color-positive)] tabular-nums mt-1 block">
                  +{{ formatCurrency(rep.cashFlow.totalInflows) }}
                </span>
                <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Income & repayments</span>
              </div>

              <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
                <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] block">Total Outflows</span>
                <span class="font-mono text-lg font-bold text-[#B24C4C] tabular-nums mt-1 block">
                  -{{ formatCurrency(rep.cashFlow.totalOutflows) }}
                </span>
                <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Expenses, tax, investments</span>
              </div>

              <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
                <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] block">Net Movement</span>
                <span
                  class="font-mono text-lg font-bold tabular-nums mt-1 block"
                  [class.text-[var(--color-positive)]]="rep.cashFlow.netMovement >= 0"
                  [class.text-[#B24C4C]]="rep.cashFlow.netMovement < 0"
                >
                  {{ rep.cashFlow.netMovement >= 0 ? '+' : '' }}{{ formatCurrency(rep.cashFlow.netMovement) }}
                </span>
                <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Net liquidity delta</span>
              </div>
            </div>

            <!-- Outflows Detailed Breakdown -->
            <div class="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <span class="text-xs uppercase font-mono tracking-wider text-[var(--color-secondary)] block">Outflow Components</span>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div class="p-2 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]/40">
                  <span class="text-[10px] text-[var(--color-secondary)] block">Consumption</span>
                  <span class="font-mono font-medium text-[var(--color-ink)]">{{ formatCurrency(rep.cashFlow.breakdown.consumptionOutflow) }}</span>
                </div>
                <div class="p-2 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]/40">
                  <span class="text-[10px] text-[var(--color-secondary)] block">Direct Tax</span>
                  <span class="font-mono font-medium text-[var(--color-ink)]">{{ formatCurrency(rep.cashFlow.breakdown.taxOutflow) }}</span>
                </div>
                <div class="p-2 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]/40">
                  <span class="text-[10px] text-[var(--color-secondary)] block">Investments</span>
                  <span class="font-mono font-medium text-[var(--color-ink)]">{{ formatCurrency(rep.cashFlow.breakdown.investmentOutflow) }}</span>
                </div>
                <div class="p-2 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]/40">
                  <span class="text-[10px] text-[var(--color-secondary)] block">Asset Purchases</span>
                  <span class="font-mono font-medium text-[var(--color-ink)]">{{ formatCurrency(rep.cashFlow.breakdown.assetPurchasesOutflow) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Internal Transfers Integrity Card -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 flex flex-col justify-between space-y-4">
            <div>
              <div class="flex items-center space-x-2 text-[var(--color-secondary)] mb-1">
                <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-accent)]">sync_alt</mat-icon>
                <span class="text-xs font-mono uppercase tracking-wider font-semibold">Internal Transfers</span>
              </div>
              <h4 class="font-editorial text-base font-semibold text-[var(--color-ink)]">
                Net Wealth Neutrality
              </h4>
              <p class="text-xs text-[var(--color-secondary)] mt-1 leading-relaxed">
                Transfers between your owned accounts never distort personal cash flow. Money moving from Bank A to Bank B is neither income nor expense.
              </p>
            </div>

            <div class="space-y-3 p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 text-xs">
              <div class="flex justify-between items-center">
                <span class="text-[var(--color-secondary)]">Transferred Volume:</span>
                <span class="font-mono font-semibold text-[var(--color-ink)]">{{ formatCurrency(rep.cashFlow.internalTransferVolume) }}</span>
              </div>
              <div class="flex justify-between items-center pt-2 border-t border-[var(--color-border)]/40">
                <span class="text-[var(--color-secondary)]">Net Cash Impact:</span>
                <span class="font-mono font-bold text-[var(--color-positive)]">₹0.00</span>
              </div>
              <div class="text-[11px] text-[var(--color-secondary)] italic pt-1">
                Paired double-leg transfer records balance out exactly to ₹0.
              </div>
            </div>

            <div class="text-right">
              <a routerLink="/transactions" class="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center space-x-1">
                <span>View all transfer records</span>
                <mat-icon class="text-[14px] w-3.5 h-3.5">arrow_forward</mat-icon>
              </a>
            </div>
          </div>
        </div>

        <!-- 4. FINANCIAL COMPOSITION & UNTRACKED ROADMAP -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-editorial text-xl font-semibold text-[var(--color-ink)]">
                Financial Composition
              </h3>
              <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                Current distribution across active bank and physical cash accounts as of {{ prettyDate(rep.netWorth.asOfDate) }}.
              </p>
            </div>
            <a routerLink="/accounts" class="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center space-x-1 font-medium">
              <span>Manage Accounts</span>
              <mat-icon class="text-[14px] w-3.5 h-3.5">arrow_forward</mat-icon>
            </a>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Available Accounts Breakdown -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 lg:col-span-2 space-y-4">
              <div class="flex items-center justify-between text-xs font-mono text-[var(--color-secondary)]">
                <span>ACCOUNT NAME</span>
                <span>AS-OF BALANCE / SHARE</span>
              </div>

              <div class="divide-y divide-[var(--color-border)]">
                @for (acc of rep.composition.accounts; track acc.id) {
                  <div class="py-3 flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                      <div class="w-8 h-8 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
                        <mat-icon class="text-[18px] w-[18px] h-[18px]">
                          {{ acc.type === 'bank' ? 'account_balance' : 'payments' }}
                        </mat-icon>
                      </div>
                      <div>
                        <div class="flex items-center space-x-2">
                          <span class="text-sm font-semibold text-[var(--color-ink)]">{{ acc.name }}</span>
                        </div>
                        <div class="text-[11px] text-[var(--color-secondary)]">
                          {{ acc.type === 'bank' ? (acc.institution || 'Bank Account') : 'Physical Cash' }}
                          @if (acc.isReconciled) {
                            <span aria-hidden="true">·</span>
                            <span class="text-[var(--color-positive)] font-medium">Reconciled</span>
                          }
                        </div>
                      </div>
                    </div>

                    <div class="text-right">
                      <span class="font-mono text-sm font-bold text-[var(--color-ink)] tabular-nums block">
                        {{ formatCurrency(acc.asOfBalance) }}
                      </span>
                      @if (rep.netWorth.isHistoricalReconstruction && acc.asOfBalance !== acc.calculatedBalance) {
                        <span class="text-[10px] font-mono text-[var(--color-secondary)] block">
                          Current: {{ formatCurrency(acc.calculatedBalance) }}
                        </span>
                      }
                      <span class="text-[11px] font-mono text-[var(--color-secondary)] block">
                        {{ acc.sharePercentage }}% of liquid cash
                      </span>
                    </div>
                  </div>
                } @empty {
                  <div class="py-8 text-center text-xs text-[var(--color-secondary)]">
                    No active accounts found.
                    <a routerLink="/accounts" class="text-[var(--color-accent)] underline ml-1">Create an account</a>.
                  </div>
                }
              </div>
            </div>

            <!-- Untracked Classes Architecture Card -->
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
              <div>
                <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">Future Subsystems</span>
                <h4 class="font-editorial text-base font-semibold text-[var(--color-ink)] mt-0.5">
                  Asset Classes Extensibility
                </h4>
                <p class="text-xs text-[var(--color-secondary)] mt-1">
                  Fractal Finance will populate these asset classes as specialized modules are implemented.
                </p>
              </div>

              <div class="space-y-2.5">
                @for (cls of rep.composition.untrackedClasses; track cls.name) {
                  <div class="p-3 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)]/60 text-xs space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-[var(--color-ink)]">{{ cls.name }}</span>
                      <span class="text-[10px] font-mono text-[var(--color-secondary)]">{{ cls.status }}</span>
                    </div>
                    <p class="text-[11px] text-[var(--color-secondary)] leading-relaxed">
                      {{ cls.description }}
                    </p>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- 5. CATEGORY BREAKDOWN & MONTHLY TRENDS -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Spending by Category (Respecting split allocations) -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                  Spending by Category
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Allocations for consumption and asset purchases in the selected period.
                </p>
              </div>
              <span class="text-xs font-mono text-[var(--color-secondary)]">
                {{ rep.categoryBreakdown.length }} Categories
              </span>
            </div>

            <div class="space-y-3 pt-2">
              @for (cat of rep.categoryBreakdown; track cat.categoryId) {
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center space-x-2">
                      <span class="w-2.5 h-2.5 rounded-full" [style.backgroundColor]="cat.color"></span>
                      <span class="font-medium text-[var(--color-ink)]">{{ cat.categoryName }}</span>
                    </div>
                    <div class="flex items-center space-x-2 font-mono">
                      <span class="text-[var(--color-secondary)]">{{ cat.percentage }}%</span>
                      <span class="font-semibold text-[var(--color-ink)]">{{ formatCurrency(cat.amount) }}</span>
                    </div>
                  </div>
                  <!-- Minimalist visual bar -->
                  <div class="h-1.5 w-full bg-[var(--color-canvas)] rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      [style.width.%]="cat.percentage"
                      [style.backgroundColor]="cat.color"
                    ></div>
                  </div>
                </div>
              } @empty {
                <div class="py-8 text-center text-xs text-[var(--color-secondary)]">
                  No categorized expenses recorded in this period.
                </div>
              }
            </div>
          </div>

          <!-- Monthly Trend Summary (Taxes subtracted for true net savings) -->
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                  Historical Monthly Trends
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Income, taxes, and expenses trajectory across recent months.
                </p>
              </div>
              <span class="text-xs font-mono text-[var(--color-secondary)]">Recent Months</span>
            </div>

            <div class="space-y-2 pt-2">
              @for (m of rep.monthlyTrends; track m.monthKey) {
                <div class="p-3 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)]/60 text-xs flex items-center justify-between">
                  <div>
                    <span class="font-medium text-[var(--color-ink)]">{{ m.label }}</span>
                    <div class="text-[11px] text-[var(--color-secondary)] space-x-2 mt-0.5 flex flex-wrap items-center">
                      <span class="text-[var(--color-positive)] font-mono">+{{ formatCurrency(m.grossIncome) }}</span>
                      @if (m.netTaxPaid > 0) {
                        <span aria-hidden="true">·</span>
                        <span class="text-[#A8752F] font-mono">Tax: -{{ formatCurrency(m.netTaxPaid) }}</span>
                      }
                      <span aria-hidden="true">·</span>
                      <span class="text-[#B24C4C] font-mono">Exp: -{{ formatCurrency(m.expenses) }}</span>
                    </div>
                  </div>

                  <div class="text-right">
                    <span
                      class="font-mono font-semibold tabular-nums block"
                      [class.text-[var(--color-positive)]]="m.savings >= 0"
                      [class.text-[#B24C4C]]="m.savings < 0"
                    >
                      {{ m.savings >= 0 ? '+' : '' }}{{ formatCurrency(m.savings) }}
                    </span>
                    <span class="text-[10px] text-[var(--color-secondary)] block">Net savings</span>
                  </div>
                </div>
              } @empty {
                <div class="py-8 text-center text-xs text-[var(--color-secondary)]">
                  No historical monthly trend data available.
                </div>
              }
            </div>
          </div>
        </div>

        <!-- 6. OBJECTIVE FINANCIAL HEALTH (NO ARBITRARY SCORES) -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 space-y-6">
          <div>
            <div class="flex items-center space-x-2 text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">
              <span>Financial Indicators</span>
              <span aria-hidden="true">·</span>
              <span>Objective Metrics</span>
            </div>
            <h3 class="font-editorial text-2xl font-semibold text-[var(--color-ink)] mt-1">
              Objective Financial Health
            </h3>
            <p class="text-xs text-[var(--color-secondary)] mt-1 max-w-3xl leading-relaxed">
              Measurable, quantitative indicators derived purely from mathematical relationships. This is an objective analysis rather than an arbitrary subjective score.
            </p>
          </div>

          <!-- Indicator Grid -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <!-- Indicator 1: Savings Rate -->
            <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 space-y-2">
              <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">1. Savings Rate</span>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ rep.financialHealth.savingsRate.formatted }}
              </div>
              <div class="space-y-1 text-[11px] text-[var(--color-secondary)]">
                <span class="block font-mono text-[10px] text-[var(--color-accent)]">{{ rep.financialHealth.savingsRate.formula }}</span>
                <p class="leading-relaxed">{{ rep.financialHealth.savingsRate.description }}</p>
              </div>
            </div>

            <!-- Indicator 2: Cash Runway / Emergency Buffer (Consumption Expenses) -->
            <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 space-y-2">
              <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">2. Cash Runway</span>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ rep.financialHealth.cashRunwayMonths.formatted }}
              </div>
              <div class="space-y-1 text-[11px] text-[var(--color-secondary)]">
                <span class="block font-mono text-[10px] text-[var(--color-accent)]">{{ rep.financialHealth.cashRunwayMonths.formula }}</span>
                <p class="leading-relaxed">{{ rep.financialHealth.cashRunwayMonths.description }}</p>
              </div>
            </div>

            <!-- Indicator 3: Debt Ratio (Calculated from ledger obligations) -->
            <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 space-y-2">
              <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">3. Debt Ratio</span>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ rep.financialHealth.debtRatio.formatted }}
              </div>
              <div class="space-y-1 text-[11px] text-[var(--color-secondary)]">
                <span class="block font-mono text-[10px] text-[var(--color-accent)]">{{ rep.financialHealth.debtRatio.formula }}</span>
                <p class="leading-relaxed">{{ rep.financialHealth.debtRatio.description }}</p>
              </div>
            </div>

            <!-- Indicator 4: Effective Direct Tax Outflow Rate -->
            <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 space-y-2">
              <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">4. Direct Tax Rate</span>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ rep.financialHealth.effectiveTaxRate.formatted }}
              </div>
              <div class="space-y-1 text-[11px] text-[var(--color-secondary)]">
                <span class="block font-mono text-[10px] text-[var(--color-accent)]">{{ rep.financialHealth.effectiveTaxRate.formula }}</span>
                <p class="leading-relaxed">{{ rep.financialHealth.effectiveTaxRate.description }}</p>
              </div>
            </div>

            <!-- Indicator 5: Expense-to-Income Ratio -->
            <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60 space-y-2 md:col-span-2">
              <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">5. Expense-to-Income Ratio</span>
              <div class="font-mono text-2xl font-bold text-[var(--color-ink)] tabular-nums">
                {{ rep.financialHealth.expenseToIncomeRatio.formatted }}
              </div>
              <div class="space-y-1 text-[11px] text-[var(--color-secondary)]">
                <span class="block font-mono text-[10px] text-[var(--color-accent)]">{{ rep.financialHealth.expenseToIncomeRatio.formula }}</span>
                <p class="leading-relaxed">{{ rep.financialHealth.expenseToIncomeRatio.description }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 7. LIFETIME SUMMARY (ALL HISTORY BASIS) -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 md:p-8 space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div class="flex items-center space-x-2 text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">
                <span>All History Basis</span>
                <span aria-hidden="true">·</span>
                <span>Cumulative Ledger</span>
              </div>
              <h3 class="font-editorial text-2xl font-semibold text-[var(--color-ink)] mt-1">
                Lifetime Financial Summary
              </h3>
            </div>
            <span class="text-xs font-mono italic text-[var(--color-secondary)]">
              {{ rep.lifetimeSummary.disclaimer }}
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Lifetime Income</span>
              <span class="font-mono text-sm md:text-base font-bold text-[var(--color-positive)] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeGrossIncome) }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Consumption</span>
              <span class="font-mono text-sm md:text-base font-bold text-[var(--color-ink)] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeConsumptionExpenses) }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Total Expenses</span>
              <span class="font-mono text-sm md:text-base font-bold text-[#B24C4C] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeTotalExpenses) }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Lifetime Taxes</span>
              <span class="font-mono text-sm md:text-base font-bold text-[var(--color-ink)] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeNetTaxPaid) }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Lifetime Savings</span>
              <span class="font-mono text-sm md:text-base font-bold text-[var(--color-ink)] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeSavings) }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]/60">
              <span class="text-[10px] font-mono uppercase text-[var(--color-secondary)] block">Invested</span>
              <span class="font-mono text-sm md:text-base font-bold text-[var(--color-ink)] tabular-nums mt-1 block">
                {{ formatCurrency(rep.lifetimeSummary.lifetimeInvestmentAllocation) }}
              </span>
            </div>
          </div>

          <div class="pt-4 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between text-xs text-[var(--color-secondary)] font-mono gap-3">
            <span>Posted Transactions: <strong>{{ rep.lifetimeSummary.totalPostedTransactions }}</strong></span>
            <span>Active Financial Accounts: <strong>{{ rep.lifetimeSummary.totalActiveAccounts }}</strong></span>
            <span>
              Earliest Recorded Date: <strong>{{ rep.lifetimeSummary.earliestTransactionDate || 'None' }}</strong>
            </span>
          </div>
        </div>

        <!-- 8. RECENT ACTIVITY SNIPPET -->
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                Recent Ledger Activity
              </h3>
              <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                Most recent posted transactions from your canonical financial ledger.
              </p>
            </div>
            <a routerLink="/transactions" class="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center space-x-1 font-medium">
              <span>View Full Ledger</span>
              <mat-icon class="text-[14px] w-3.5 h-3.5">arrow_forward</mat-icon>
            </a>
          </div>

          <div class="divide-y divide-[var(--color-border)]">
            @for (tx of rep.recentTransactions; track tx.id) {
              <div class="py-3 flex items-center justify-between text-xs">
                <div class="flex items-center space-x-3">
                  <div class="w-7 h-7 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
                    <mat-icon class="text-[16px] w-4 h-4">
                      {{ tx.type === 'INCOME' ? 'arrow_downward' : tx.type === 'INTERNAL_TRANSFER' ? 'sync_alt' : 'arrow_upward' }}
                    </mat-icon>
                  </div>
                  <div>
                    <span class="font-medium text-[var(--color-ink)] block">{{ tx.description }}</span>
                    <span class="text-[11px] text-[var(--color-secondary)] font-mono">
                      {{ tx.transactionDate }} · {{ tx.accountName }}
                      @if (tx.categoryName) {
                        · {{ tx.categoryName }}
                      }
                    </span>
                  </div>
                </div>

                <div class="font-mono text-sm font-semibold tabular-nums" [class.text-[var(--color-positive)]]="tx.type === 'INCOME'">
                  {{ tx.type === 'INCOME' ? '+' : '' }}{{ formatCurrency(tx.amount) }}
                </div>
              </div>
            } @empty {
              <div class="py-8 text-center text-xs text-[var(--color-secondary)]">
                No recent transactions recorded.
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class Home implements OnInit {
  readonly reportingState = inject(ReportingState);
  readonly quickAdd = inject(QuickAddService);

  readonly periodOptions: PeriodOption[] = [
    { type: 'current_month', label: 'Current Month', shortLabel: 'Month' },
    { type: 'financial_year', label: 'Financial Year', shortLabel: 'FY' },
    { type: 'last_12_months', label: 'Last 12 Months', shortLabel: '12M' },
    { type: 'all_history', label: 'All History', shortLabel: 'All' },
    { type: 'custom', label: 'Custom Range', shortLabel: 'Custom' },
  ];

  readonly customRangeForm = new FormGroup({
    startDate: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    endDate: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  ngOnInit(): void {
    this.reportingState.loadReport('financial_year');
  }

  selectPeriod(period: ReportingPeriodType): void {
    if (period === 'custom') {
      this.reportingState.currentPeriod.set('custom');
      if (this.customRangeForm.valid) {
        this.applyCustomRange();
      }
      return;
    }
    this.reportingState.loadReport(period);
  }

  applyCustomRange(): void {
    if (this.customRangeForm.invalid) return;
    const { startDate, endDate } = this.customRangeForm.value;
    if (startDate && endDate) {
      this.reportingState.loadReport('custom', startDate, endDate);
    }
  }

  refreshDashboard(): void {
    this.reportingState.refresh();
  }

  formatCurrency(minorUnits: number | null | undefined): string {
    return formatMinorUnits(minorUnits, 'INR');
  }

  prettyDate(isoStr?: string | null): string {
    return isoStr ? formatPrettyDate(isoStr) : '';
  }
}
