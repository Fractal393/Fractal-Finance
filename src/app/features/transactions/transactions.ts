import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TransactionState } from '../../core/transactions/transaction-state';
import { AccountState } from '../../core/accounts/account-state';
import { QuickAddService } from '../../core/transactions/quick-add.service';
import {
  Transaction,
  TransactionType,
  TRANSACTION_TYPE_LABELS,
} from '../../core/transactions/transaction-models';
import { formatMinorUnits } from '../../core/accounts/account-models';
import { TransactionEditModal } from './transaction-edit-modal';

@Component({
  selector: 'app-transactions',
  imports: [ReactiveFormsModule, MatIconModule, TransactionEditModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 select-none pb-12">
      <!-- Page Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="font-editorial text-2xl sm:text-3xl font-bold text-[var(--color-ink)] tracking-tight">
            Financial Ledger
          </h1>
          <p class="text-xs text-[var(--color-secondary)] mt-1">
            Canonical transaction log with integer-precision ledger updates and audit verification.
          </p>
        </div>

        <div class="flex items-center space-x-2.5">
          <button
            type="button"
            (click)="quickAdd.open()"
            class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium tracking-wide bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors shadow-sm cursor-pointer"
          >
            <mat-icon class="text-[18px] w-[18px] h-[18px]">add</mat-icon>
            <span>Record Movement</span>
          </button>
        </div>
      </div>

      <!-- Metrics Strip -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <!-- 1. Total Count -->
        <div class="p-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div class="flex items-center justify-between text-[11px] font-mono uppercase text-[var(--color-secondary)]">
            <span>Total Records</span>
            <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-secondary)]">receipt_long</mat-icon>
          </div>
          <div class="font-editorial text-xl font-bold text-[var(--color-ink)] mt-1 tabular-nums">
            {{ txState.transactions().length }}
          </div>
          <span class="text-[10px] text-[var(--color-secondary)]">Loaded ledger rows</span>
        </div>

        <!-- 2. Filtered Inflow -->
        <div class="p-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div class="flex items-center justify-between text-[11px] font-mono uppercase text-[var(--color-secondary)]">
            <span>Total Inflow</span>
            <mat-icon class="text-[16px] w-4 h-4 text-emerald-600">arrow_downward</mat-icon>
          </div>
          <div class="font-editorial text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
            +₹{{ formatMinor(summaryMetrics().inflow) }}
          </div>
          <span class="text-[10px] text-[var(--color-secondary)]">Income, repayments & borrowing</span>
        </div>

        <!-- 3. Filtered Outflow -->
        <div class="p-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div class="flex items-center justify-between text-[11px] font-mono uppercase text-[var(--color-secondary)]">
            <span>Total Outflow</span>
            <mat-icon class="text-[16px] w-4 h-4 text-red-600">arrow_upward</mat-icon>
          </div>
          <div class="font-editorial text-xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">
            -₹{{ formatMinor(summaryMetrics().outflow) }}
          </div>
          <span class="text-[10px] text-[var(--color-secondary)]">Expenses, taxes & disbursements</span>
        </div>

        <!-- 4. Net Cash Impact -->
        <div class="p-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div class="flex items-center justify-between text-[11px] font-mono uppercase text-[var(--color-secondary)]">
            <span>Net Change</span>
            <mat-icon class="text-[16px] w-4 h-4 text-[var(--color-accent)]">account_balance_wallet</mat-icon>
          </div>
          <div
            class="font-editorial text-xl font-bold mt-1 tabular-nums"
            [class.text-emerald-600]="summaryMetrics().net >= 0"
            [class.text-red-600]="summaryMetrics().net < 0"
          >
            {{ summaryMetrics().net >= 0 ? '+' : '-' }}₹{{ formatMinor(Math.abs(summaryMetrics().net)) }}
          </div>
          <span class="text-[10px] text-[var(--color-secondary)]">Current filtered view</span>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs space-y-3">
        <!-- Primary Row: Search & Filters -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
          <!-- Search -->
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-secondary)]">
              <mat-icon class="text-[16px] w-4 h-4">search</mat-icon>
            </span>
            <input
              type="text"
              [value]="searchQuery()"
              (input)="onSearchInput($any($event.target).value)"
              placeholder="Search descriptions, notes..."
              class="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
            />
          </div>

          <!-- Account Filter -->
          <select
            [value]="txState.filters().accountId || ''"
            (change)="onAccountChange($any($event.target).value)"
            class="w-full px-2.5 py-1.5 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
          >
            <option value="">All Accounts</option>
            @for (acc of accountState.accounts(); track acc.id) {
              <option [value]="acc.id">{{ acc.name }} ({{ acc.currency }})</option>
            }
          </select>

          <!-- Type Filter -->
          <select
            [value]="txState.filters().type || ''"
            (change)="onTypeChange($any($event.target).value)"
            class="w-full px-2.5 py-1.5 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
          >
            <option value="">All Classifications</option>
            @for (opt of typeOptions; track opt.key) {
              <option [value]="opt.key">{{ opt.label }}</option>
            }
          </select>

          <!-- Category Filter -->
          <select
            [value]="txState.filters().categoryId || ''"
            (change)="onCategoryChange($any($event.target).value)"
            class="w-full px-2.5 py-1.5 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
          >
            <option value="">All Categories</option>
            @for (cat of txState.categories(); track cat.id) {
              <option [value]="cat.id">{{ cat.parentId ? '— ' + cat.name : cat.name }}</option>
            }
          </select>
        </div>

        <!-- Secondary Row: Status Pills & Date Range -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--color-border)]/60 text-xs">
          <!-- Status Toggle Tabs -->
          <div class="flex items-center space-x-1 p-0.5 rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)]">
            <button
              type="button"
              (click)="onStatusChange('POSTED')"
              [class.bg-[var(--color-surface)]]="txState.filters().status === 'POSTED'"
              [class.font-semibold]="txState.filters().status === 'POSTED'"
              [class.shadow-xs]="txState.filters().status === 'POSTED'"
              class="px-2.5 py-1 rounded-md text-[11px] text-[var(--color-ink)] transition-colors cursor-pointer"
            >
              Active Posted
            </button>
            <button
              type="button"
              (click)="onStatusChange('VOIDED')"
              [class.bg-[var(--color-surface)]]="txState.filters().status === 'VOIDED'"
              [class.font-semibold]="txState.filters().status === 'VOIDED'"
              [class.shadow-xs]="txState.filters().status === 'VOIDED'"
              class="px-2.5 py-1 rounded-md text-[11px] text-[var(--color-ink)] transition-colors cursor-pointer"
            >
              Voided Records
            </button>
            <button
              type="button"
              (click)="onStatusChange('ALL')"
              [class.bg-[var(--color-surface)]]="txState.filters().status === 'ALL'"
              [class.font-semibold]="txState.filters().status === 'ALL'"
              [class.shadow-xs]="txState.filters().status === 'ALL'"
              class="px-2.5 py-1 rounded-md text-[11px] text-[var(--color-ink)] transition-colors cursor-pointer"
            >
              All Records
            </button>
          </div>

          <!-- Reset Filter Button -->
          @if (hasActiveFilters()) {
            <button
              type="button"
              (click)="resetFilters()"
              class="inline-flex items-center space-x-1 text-xs text-[var(--color-secondary)] hover:text-[var(--color-ink)] cursor-pointer"
            >
              <mat-icon class="text-[14px] w-3.5 h-3.5">restart_alt</mat-icon>
              <span>Reset Filters</span>
            </button>
          }
        </div>
      </div>

      <!-- Transaction Table / List Card -->
      <div class="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs overflow-hidden">
        @if (txState.loading() && txState.transactions().length === 0) {
          <!-- Loading State -->
          <div class="py-16 text-center text-xs text-[var(--color-secondary)] space-y-2">
            <mat-icon class="animate-spin text-2xl text-[var(--color-accent)]">sync</mat-icon>
            <p>Loading transactions ledger...</p>
          </div>
        } @else if (txState.transactions().length === 0) {
          <!-- Empty State -->
          <div class="py-16 px-4 text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center mx-auto text-[var(--color-secondary)]">
              <mat-icon class="text-2xl">receipt</mat-icon>
            </div>
            <h3 class="font-editorial text-lg font-bold text-[var(--color-ink)]">
              No transactions found
            </h3>
            <p class="text-xs text-[var(--color-secondary)] max-w-sm mx-auto">
              {{ hasActiveFilters() ? 'Try adjusting your filters or search term to see more entries.' : 'Start tracking by recording your first transaction or transfer.' }}
            </p>
            <button
              type="button"
              (click)="quickAdd.open()"
              class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
            >
              <mat-icon class="text-[16px] w-4 h-4">add</mat-icon>
              <span>Record First Movement</span>
            </button>
          </div>
        } @else {
          <!-- Transaction Rows -->
          <div class="divide-y divide-[var(--color-border)]">
            @for (tx of txState.transactions(); track tx.id) {
              <div
                role="button"
                tabindex="0"
                (click)="openEditModal(tx)"
                (keydown.enter)="openEditModal(tx)"
                (keydown.space)="openEditModal(tx)"
                class="p-4 hover:bg-[var(--color-canvas)]/60 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
              >
                <!-- Left: Icon + Description + Meta -->
                <div class="flex items-start space-x-3 min-w-0">
                  <!-- Type Icon Avatar -->
                  <div
                    class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border mt-0.5"
                    [class.bg-emerald-500/10]="isPositiveMovement(tx)"
                    [class.border-emerald-500/20]="isPositiveMovement(tx)"
                    [class.text-emerald-700]="isPositiveMovement(tx)"
                    [class.bg-red-500/10]="!isPositiveMovement(tx) && tx.type !== 'INTERNAL_TRANSFER'"
                    [class.border-red-500/20]="!isPositiveMovement(tx) && tx.type !== 'INTERNAL_TRANSFER'"
                    [class.text-red-700]="!isPositiveMovement(tx) && tx.type !== 'INTERNAL_TRANSFER'"
                    [class.bg-blue-500/10]="tx.type === 'INTERNAL_TRANSFER'"
                    [class.border-blue-500/20]="tx.type === 'INTERNAL_TRANSFER'"
                    [class.text-blue-700]="tx.type === 'INTERNAL_TRANSFER'"
                  >
                    <mat-icon class="text-[18px] w-[18px] h-[18px]">
                      {{ getTypeIcon(tx.type) }}
                    </mat-icon>
                  </div>

                  <!-- Details -->
                  <div class="min-w-0">
                    <div class="flex items-center space-x-2">
                      <span
                        class="text-xs sm:text-sm font-medium text-[var(--color-ink)] truncate"
                        [class.line-through]="tx.status === 'VOIDED'"
                        [class.opacity-50]="tx.status === 'VOIDED'"
                      >
                        {{ tx.description }}
                      </span>

                      @if (tx.status === 'VOIDED') {
                        <span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-red-500/10 text-red-600 border border-red-500/20 shrink-0">
                          Voided
                        </span>
                      }
                    </div>

                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-secondary)] mt-0.5">
                      <!-- Date -->
                      <span class="font-mono">{{ tx.transactionDate }}</span>
                      <span>•</span>

                      <!-- Account -->
                      <span class="font-medium">{{ getAccountName(tx.accountId) }}</span>

                      <!-- Destination Account if transfer -->
                      @if (tx.transferDirection) {
                        <span>{{ tx.transferDirection === 'OUT' ? '→' : '←' }} {{ getAccountName(tx.destinationAccountId) }}</span>
                      }

                      <!-- Category / Split badge -->
                      @if (tx.allocations && tx.allocations.length > 0) {
                        <span>•</span>
                        <span class="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-[var(--color-canvas)] border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-accent)]">
                          <mat-icon class="text-[12px] w-3 h-3">call_split</mat-icon>
                          <span>Split ({{ tx.allocations.length }})</span>
                        </span>
                      } @else if (tx.categoryId) {
                        <span>•</span>
                        <span class="px-1.5 py-0.2 rounded bg-[var(--color-canvas)] text-[10px] text-[var(--color-ink)]">
                          {{ getCategoryName(tx.categoryId) }}
                        </span>
                      }

                      <!-- Counterparty -->
                      @if (tx.counterpartyId) {
                        <span>•</span>
                        <span>{{ getCounterpartyName(tx.counterpartyId) }}</span>
                      }
                    </div>

                    <!-- Tags if any -->
                    @if (tx.tags && tx.tags.length > 0) {
                      <div class="flex items-center space-x-1 mt-1">
                        @for (tag of tx.tags; track tag) {
                          <span class="text-[9px] font-mono text-[var(--color-secondary)]">#{{ tag }}</span>
                        }
                      </div>
                    }
                  </div>
                </div>

                <!-- Right: Amount & Actions -->
                <div class="text-right shrink-0 flex items-center space-x-3">
                  <div>
                    <div
                      class="font-editorial text-sm sm:text-base font-bold tabular-nums"
                      [class.text-emerald-700]="isPositiveMovement(tx)"
                      [class.text-red-700]="!isPositiveMovement(tx) && tx.type !== 'INTERNAL_TRANSFER'"
                      [class.text-[var(--color-ink)]]="tx.type === 'INTERNAL_TRANSFER'"
                      [class.line-through]="tx.status === 'VOIDED'"
                      [class.opacity-40]="tx.status === 'VOIDED'"
                    >
                      {{ getAmountPrefix(tx) }}₹{{ formatMinor(tx.amount) }}
                    </div>
                    <div class="text-[10px] font-mono uppercase text-[var(--color-secondary)]">
                      {{ getClassificationLabel(tx.type) }}
                    </div>
                  </div>

                  <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-secondary)]">chevron_right</mat-icon>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Pagination / Load More Bar -->
          @if (txState.hasMore()) {
            <div class="p-4 border-t border-[var(--color-border)] text-center bg-[var(--color-canvas)]">
              <button
                type="button"
                [disabled]="txState.loading()"
                (click)="loadMore()"
                class="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] text-[var(--color-ink)] transition-colors cursor-pointer"
              >
                @if (txState.loading()) {
                  <span class="inline-flex items-center space-x-1.5">
                    <mat-icon class="animate-spin text-[14px] w-3.5 h-3.5">sync</mat-icon>
                    <span>Loading more rows...</span>
                  </span>
                } @else {
                  <span>Load More Transactions</span>
                }
              </button>
            </div>
          }
        }
      </div>

      <!-- Edit / Detail Modal -->
      @if (activeModalTx()) {
        <app-transaction-edit-modal
          [transaction]="activeModalTx()"
          (closed)="closeEditModal()"
        />
      }
    </div>
  `,
})
export class Transactions implements OnInit {
  readonly txState = inject(TransactionState);
  readonly accountState = inject(AccountState);
  readonly quickAdd = inject(QuickAddService);

  readonly searchQuery = signal<string>('');
  readonly activeModalTx = signal<Transaction | null>(null);

  readonly Math = Math;

  readonly typeOptions = (Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((key) => ({
    key,
    ...TRANSACTION_TYPE_LABELS[key],
  }));

  readonly summaryMetrics = computed(() => {
    let inflow = 0;
    let outflow = 0;

    for (const t of this.txState.transactions()) {
      if (t.status === 'VOIDED') continue;

      if (this.isPositiveMovement(t)) {
        inflow += t.amount;
      } else if (t.type !== 'INTERNAL_TRANSFER') {
        outflow += t.amount;
      }
    }

    return {
      inflow,
      outflow,
      net: inflow - outflow,
    };
  });

  ngOnInit(): void {
    if (this.accountState.accounts().length === 0) {
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Accounts load skipped:', err);
      });
    }
    this.txState.loadMetadata().catch((err: unknown) => {
      console.warn('Metadata load skipped:', err);
    });
    this.txState.loadTransactions(true).catch((err: unknown) => {
      console.warn('Transactions load skipped:', err);
    });
  }

  isPositiveMovement(tx: Transaction): boolean {
    if (tx.type === 'INCOME' || tx.type === 'RECEIVABLE_REPAYMENT' || tx.type === 'DEBT_BORROWING') {
      return true;
    }
    if (tx.type === 'INTERNAL_TRANSFER' && tx.transferDirection === 'IN') {
      return true;
    }
    return false;
  }

  getAmountPrefix(tx: Transaction): string {
    if (tx.type === 'INTERNAL_TRANSFER') {
      return tx.transferDirection === 'IN' ? '+' : '-';
    }
    return this.isPositiveMovement(tx) ? '+' : '-';
  }

  getTypeIcon(type: TransactionType): string {
    return TRANSACTION_TYPE_LABELS[type]?.icon || 'receipt';
  }

  getClassificationLabel(type: TransactionType): string {
    return TRANSACTION_TYPE_LABELS[type]?.label || type;
  }

  getAccountName(accId: string | null | undefined): string {
    if (!accId) return '—';
    const acc = this.accountState.accounts().find((a) => a.id === accId);
    return acc ? acc.name : accId;
  }

  getCategoryName(catId: string | null | undefined): string {
    if (!catId) return 'Unassigned';
    const cat = this.txState.categories().find((c) => c.id === catId);
    return cat ? cat.name : catId;
  }

  getCounterpartyName(cpId: string | null | undefined): string {
    if (!cpId) return '—';
    const cp = this.txState.counterparties().find((c) => c.id === cpId);
    return cp ? cp.name : cpId;
  }

  formatMinor(minor: number): string {
    return formatMinorUnits(minor);
  }

  hasActiveFilters(): boolean {
    const f = this.txState.filters();
    return !!(f.accountId || f.type || f.categoryId || f.search || (f.status && f.status !== 'POSTED'));
  }

  onSearchInput(query: string): void {
    this.searchQuery.set(query);
    this.txState.setFilter('search', query || undefined);
  }

  onAccountChange(accId: string): void {
    this.txState.setFilter('accountId', accId || undefined);
  }

  onTypeChange(typeStr: string): void {
    this.txState.setFilter('type', (typeStr as TransactionType) || undefined);
  }

  onCategoryChange(catId: string): void {
    this.txState.setFilter('categoryId', catId || undefined);
  }

  onStatusChange(status: 'POSTED' | 'VOIDED' | 'ALL'): void {
    this.txState.setFilter('status', status);
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.txState.resetFilters();
  }

  loadMore(): void {
    this.txState.loadTransactions(false);
  }

  openEditModal(tx: Transaction): void {
    this.activeModalTx.set(tx);
  }

  closeEditModal(): void {
    this.activeModalTx.set(null);
  }
}
