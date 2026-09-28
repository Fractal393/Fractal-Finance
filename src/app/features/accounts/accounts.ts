import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AccountState } from '../../core/accounts/account-state';
import {
  Account,
  formatMinorUnits,
  toMinorUnits,
  toMajorUnits,
} from '../../core/accounts/account-models';

@Component({
  selector: 'app-accounts',
  imports: [ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 antialiased pb-12">
      <!-- Header & Summary Bar -->
      <div class="border-b border-[var(--color-border)] pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div class="flex items-center space-x-2">
            <span class="text-xs font-mono uppercase tracking-widest text-[var(--color-secondary)]">Financial OS</span>
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-accent)] font-semibold">Slice 2</span>
          </div>
          <h2 class="font-editorial text-3xl font-semibold text-[var(--color-ink)] mt-1">
            Accounts & Balances
          </h2>
          <p class="text-xs text-[var(--color-secondary)] mt-1">
            Audited bank accounts, single canonical Cash custody, opening balances, and statement reconciliation.
          </p>
        </div>

        <div class="flex items-center space-x-3">
          <button
            type="button"
            (click)="openCreateModal()"
            class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium tracking-wide bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors shadow-sm cursor-pointer"
          >
            <mat-icon class="text-[18px] w-[18px] h-[18px]">add</mat-icon>
            <span>New Account</span>
          </button>
        </div>
      </div>

      <!-- Quick Metrics Summary -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)]">Total Net Liquidity</span>
          <div class="mt-1 font-editorial text-2xl font-bold text-[var(--color-ink)] tabular-nums">
            {{ formatCurrency(accountState.totalCalculatedBalance()) }}
          </div>
          <div class="mt-1 text-[11px] text-[var(--color-secondary)] flex items-center space-x-1">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-positive)]"></span>
            <span>Across {{ accountState.activeAccountsCount() }} active accounts</span>
          </div>
        </div>

        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)]">Canonical Cash Custody</span>
          <div class="mt-1 font-editorial text-2xl font-bold text-[var(--color-ink)] tabular-nums">
            @if (accountState.cashAccount()) {
              {{ formatCurrency(accountState.cashAccount()!.calculatedBalance, accountState.cashAccount()!.currency) }}
            } @else {
              <span class="text-[var(--color-secondary)] font-sans text-base font-normal">Not configured</span>
            }
          </div>
          <div class="mt-1 text-[11px] text-[var(--color-secondary)]">
            @if (accountState.hasCashAccount()) {
              <span class="text-[var(--color-positive)]">Single canonical wallet established</span>
            } @else {
              <span class="text-[var(--color-warning)]">Create Cash account to track physical cash</span>
            }
          </div>
        </div>

        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)]">Audit & Math Standard</span>
          <div class="mt-1 text-sm font-semibold text-[var(--color-ink)]">
            Integer Minor Units (Paise)
          </div>
          <div class="mt-1 text-[11px] text-[var(--color-secondary)]">
            Zero floating-point drift • Server-verified mutations
          </div>
        </div>
      </div>

      <!-- Error Banner -->
      @if (accountState.error()) {
        <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <mat-icon class="text-[18px] w-[18px] h-[18px]">error_outline</mat-icon>
            <span>{{ accountState.error() }}</span>
          </div>
          <button (click)="accountState.loadAccounts()" class="underline font-mono text-[11px] cursor-pointer">Retry</button>
        </div>
      }

      <!-- Main Layout: Desktop Split-Pane / Mobile Stacked -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Accounts List Column (lg:col-span-5) -->
        <div class="lg:col-span-5 space-y-6">
          <!-- Canonical Cash Account Card -->
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">Cash Custody</span>
              <span class="text-[10px] font-mono text-[var(--color-secondary)]">Canonical (Max 1)</span>
            </div>

            @if (accountState.cashAccount(); as cash) {
              <button
                type="button"
                (click)="accountState.selectAccount(cash.id)"
                [class.ring-2]="accountState.selectedAccountId() === cash.id"
                [class.ring-[var(--color-accent)]]="accountState.selectedAccountId() === cash.id"
                class="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 transition-all hover:border-[var(--color-accent)] cursor-pointer select-none relative block"
              >
                <div class="flex items-start justify-between">
                  <div class="flex items-center space-x-3">
                    <div class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                      <mat-icon class="text-[20px] w-5 h-5">payments</mat-icon>
                    </div>
                    <div>
                      <h4 class="font-editorial text-base font-semibold text-[var(--color-ink)] leading-snug">
                        {{ cash.name }}
                      </h4>
                      <p class="text-xs text-[var(--color-secondary)]">
                        {{ cash.institution }} • {{ cash.currency }}
                      </p>
                    </div>
                  </div>

                  <div class="text-right">
                    <span class="font-editorial text-lg font-bold text-[var(--color-ink)] tabular-nums block">
                      {{ formatCurrency(cash.calculatedBalance, cash.currency) }}
                    </span>
                    <span class="text-[10px] font-mono text-[var(--color-secondary)]">
                      Calculated
                    </span>
                  </div>
                </div>

                <div class="mt-3 pt-3 border-t border-[var(--color-border)]/60 flex items-center justify-between text-[11px] text-[var(--color-secondary)]">
                  <span>Reconciled: {{ formatDate(cash.lastReconciledAt) }}</span>
                  <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]">
                    {{ cash.isActive ? 'Active' : 'Archived' }}
                  </span>
                </div>
              </button>
            } @else {
              <div class="border border-dashed border-[var(--color-border)] rounded-xl p-5 text-center bg-[var(--color-surface)]/50">
                <mat-icon class="text-[28px] w-7 h-7 text-[var(--color-secondary)] mx-auto mb-1">payments</mat-icon>
                <h5 class="text-xs font-semibold text-[var(--color-ink)]">No Cash Account Found</h5>
                <p class="text-[11px] text-[var(--color-secondary)] mt-0.5">
                  Create your single canonical physical cash account.
                </p>
                <button
                  type="button"
                  (click)="openCreateCashModal()"
                  class="mt-3 inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
                >
                  <mat-icon class="text-[16px] w-4 h-4">add</mat-icon>
                  <span>Initialize Cash Account</span>
                </button>
              </div>
            }
          </div>

          <!-- Bank Accounts Section -->
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">Bank Accounts</span>
              <span class="text-[10px] font-mono text-[var(--color-secondary)]">{{ accountState.bankAccounts().length }} Total</span>
            </div>

            @if (accountState.bankAccounts().length === 0) {
              <div class="border border-dashed border-[var(--color-border)] rounded-xl p-6 text-center bg-[var(--color-surface)]/50">
                <mat-icon class="text-[28px] w-7 h-7 text-[var(--color-secondary)] mx-auto mb-1">account_balance</mat-icon>
                <h5 class="text-xs font-semibold text-[var(--color-ink)]">No Bank Accounts Configured</h5>
                <p class="text-[11px] text-[var(--color-secondary)] mt-0.5">
                  Add checking, savings, or salary accounts to manage ledger balances.
                </p>
                <button
                  type="button"
                  (click)="openCreateModal('bank')"
                  class="mt-3 inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
                >
                  <mat-icon class="text-[16px] w-4 h-4">add</mat-icon>
                  <span>Add Bank Account</span>
                </button>
              </div>
            } @else {
              <div class="space-y-2">
                @for (acc of accountState.bankAccounts(); track acc.id) {
                  <button
                    type="button"
                    (click)="accountState.selectAccount(acc.id)"
                    [class.ring-2]="accountState.selectedAccountId() === acc.id"
                    [class.ring-[var(--color-accent)]]="accountState.selectedAccountId() === acc.id"
                    class="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 transition-all hover:border-[var(--color-accent)] cursor-pointer select-none block"
                  >
                    <div class="flex items-start justify-between">
                      <div class="flex items-center space-x-3">
                        <div class="w-9 h-9 rounded-lg bg-[var(--color-canvas)] text-[var(--color-accent)] border border-[var(--color-border)] flex items-center justify-center">
                          <mat-icon class="text-[20px] w-5 h-5">account_balance</mat-icon>
                        </div>
                        <div>
                          <h4 class="font-editorial text-base font-semibold text-[var(--color-ink)] leading-snug">
                            {{ acc.name }}
                          </h4>
                          <p class="text-xs text-[var(--color-secondary)]">
                            {{ acc.institution }} • {{ acc.currency }}
                          </p>
                        </div>
                      </div>

                      <div class="text-right">
                        <span class="font-editorial text-lg font-bold text-[var(--color-ink)] tabular-nums block">
                          {{ formatCurrency(acc.calculatedBalance, acc.currency) }}
                        </span>
                        <span class="text-[10px] font-mono text-[var(--color-secondary)]">
                          Calculated
                        </span>
                      </div>
                    </div>

                    <div class="mt-3 pt-3 border-t border-[var(--color-border)]/60 flex items-center justify-between text-[11px] text-[var(--color-secondary)]">
                      <span>Reconciled: {{ formatDate(acc.lastReconciledAt) }}</span>
                      <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]">
                        {{ acc.isActive ? 'Active' : 'Archived' }}
                      </span>
                    </div>
                  </button>
                }
              </div>
            }
          </div>
        </div>

        <!-- Selected Account Detail Column (lg:col-span-7) -->
        <div class="lg:col-span-7">
          @if (accountState.selectedAccount(); as selected) {
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
              <!-- Detail Header -->
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-3">
                <div class="flex items-center space-x-3">
                  <div class="w-11 h-11 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
                    <mat-icon class="text-[24px] w-6 h-6">
                      {{ selected.type === 'cash' ? 'payments' : 'account_balance' }}
                    </mat-icon>
                  </div>
                  <div>
                    <div class="flex items-center space-x-2">
                      <h3 class="font-editorial text-2xl font-bold text-[var(--color-ink)]">
                        {{ selected.name }}
                      </h3>
                      <span class="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-secondary)]">
                        {{ selected.type }}
                      </span>
                    </div>
                    <p class="text-xs text-[var(--color-secondary)]">
                      {{ selected.institution }} • {{ selected.currency }} • ID: <span class="font-mono">{{ selected.id.slice(0, 8) }}...</span>
                    </p>
                  </div>
                </div>

                <div class="flex items-center space-x-2">
                  <button
                    type="button"
                    (click)="openEditModal(selected)"
                    class="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-canvas)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                  >
                    <mat-icon class="text-[16px] w-4 h-4">edit</mat-icon>
                    <span>Edit</span>
                  </button>

                  <button
                    type="button"
                    (click)="openReconcileModal(selected)"
                    class="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer shadow-sm"
                  >
                    <mat-icon class="text-[16px] w-4 h-4">balance</mat-icon>
                    <span>Reconcile</span>
                  </button>
                </div>
              </div>

              <!-- Balance Breakdown Matrix -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="bg-[var(--color-canvas)] border border-[var(--color-border)] rounded-xl p-4">
                  <span class="text-[10px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">
                    Calculated Balance
                  </span>
                  <div class="font-editorial text-xl font-bold text-[var(--color-ink)] tabular-nums mt-1">
                    {{ formatCurrency(selected.calculatedBalance, selected.currency) }}
                  </div>
                  <span class="text-[10px] text-[var(--color-secondary)] block mt-1">
                    Opening: {{ formatCurrency(selected.openingBalance, selected.currency) }} ({{ selected.openingBalanceDate }})
                  </span>
                </div>

                <div class="bg-[var(--color-canvas)] border border-[var(--color-border)] rounded-xl p-4">
                  <span class="text-[10px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">
                    Reported Balance
                  </span>
                  <div class="font-editorial text-xl font-bold text-[var(--color-ink)] tabular-nums mt-1">
                    @if (selected.reportedBalance !== null && selected.reportedBalance !== undefined) {
                      {{ formatCurrency(selected.reportedBalance, selected.currency) }}
                    } @else {
                      <span class="text-xs font-sans text-[var(--color-secondary)] font-normal">Pending snapshot</span>
                    }
                  </div>
                  <span class="text-[10px] text-[var(--color-secondary)] block mt-1">
                    Last: {{ formatDate(selected.lastReconciledAt) }}
                  </span>
                </div>

                <div class="bg-[var(--color-canvas)] border border-[var(--color-border)] rounded-xl p-4">
                  <span class="text-[10px] font-mono uppercase tracking-wider text-[var(--color-secondary)] block">
                    Variance Delta
                  </span>
                  @let delta = getVariance(selected);
                  <div
                    [class.text-emerald-700]="delta === 0"
                    [class.dark:text-emerald-400]="delta === 0"
                    [class.text-amber-700]="delta !== 0 && delta !== null"
                    [class.dark:text-amber-400]="delta !== 0 && delta !== null"
                    class="font-editorial text-xl font-bold tabular-nums mt-1"
                  >
                    @if (delta === null) {
                      <span class="text-xs font-sans text-[var(--color-secondary)] font-normal">No snapshot</span>
                    } @else if (delta === 0) {
                      Balanced (₹0.00)
                    } @else {
                      {{ delta > 0 ? '+' : '' }}{{ formatCurrency(delta, selected.currency) }}
                    }
                  </div>
                  <span class="text-[10px] text-[var(--color-secondary)] block mt-1">
                    Reported − Calculated
                  </span>
                </div>
              </div>

              <!-- Reconciliation Action Banner -->
              <div class="bg-[var(--color-canvas)]/60 border border-[var(--color-border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="flex items-start space-x-3">
                  <div class="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center shrink-0 mt-0.5">
                    <mat-icon class="text-[18px] w-[18px] h-[18px]">verified_user</mat-icon>
                  </div>
                  <div>
                    <h5 class="text-xs font-semibold text-[var(--color-ink)]">
                      Audit-Enforced Statement Reconciliation
                    </h5>
                    <p class="text-[11px] text-[var(--color-secondary)] leading-relaxed">
                      Snapshots record external bank statements or cash drawer audits without silently altering financial history. Discrepancies generate audited adjustment entries.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  (click)="openReconcileModal(selected)"
                  class="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer shrink-0"
                >
                  <mat-icon class="text-[16px] w-4 h-4">fact_check</mat-icon>
                  <span>Reconcile Now</span>
                </button>
              </div>

              <!-- Balance Snapshot History Timeline -->
              <div class="space-y-3 pt-2">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">
                    Reported Balance History
                  </h4>
                  <span class="text-[11px] font-mono text-[var(--color-secondary)]">
                    {{ accountState.balanceHistory().length }} snapshots
                  </span>
                </div>

                @if (accountState.historyLoading()) {
                  <div class="p-8 text-center text-xs text-[var(--color-secondary)]">
                    Loading historical snapshots...
                  </div>
                } @else if (accountState.balanceHistory().length === 0) {
                  <div class="p-6 text-center border border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-canvas)]/40">
                    <p class="text-xs text-[var(--color-secondary)]">
                      No reported balance snapshots yet for this account.
                    </p>
                    <button
                      type="button"
                      (click)="openReconcileModal(selected)"
                      class="mt-2 text-xs font-medium text-[var(--color-accent)] hover:underline cursor-pointer"
                    >
                      Record first balance snapshot
                    </button>
                  </div>
                } @else {
                  <div class="border border-[var(--color-border)] rounded-xl overflow-hidden">
                    <table class="w-full text-left text-xs">
                      <thead class="bg-[var(--color-canvas)] border-b border-[var(--color-border)] text-[var(--color-secondary)] font-mono text-[10px] uppercase">
                        <tr>
                          <th class="p-3">Snapshot Date</th>
                          <th class="p-3 text-right">Reported Balance</th>
                          <th class="p-3">Source</th>
                          <th class="p-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[var(--color-border)]/60">
                        @for (snap of accountState.balanceHistory(); track snap.id) {
                          <tr class="hover:bg-[var(--color-canvas)]/30 transition-colors">
                            <td class="p-3 font-mono text-[11px] text-[var(--color-ink)]">
                              {{ snap.snapshotDate }}
                            </td>
                            <td class="p-3 text-right font-editorial font-semibold text-[var(--color-ink)] tabular-nums">
                              {{ formatCurrency(snap.reportedBalance, selected.currency) }}
                            </td>
                            <td class="p-3 text-[var(--color-secondary)] capitalize font-mono text-[11px]">
                              {{ snap.source }}
                            </td>
                            <td class="p-3 text-[var(--color-secondary)] text-[11px] max-w-xs truncate">
                              {{ snap.notes || '—' }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            </div>
          } @else {
            <!-- Empty state when no account selected -->
            <div class="border border-dashed border-[var(--color-border)] rounded-xl p-12 text-center bg-[var(--color-surface)]">
              <mat-icon class="text-[36px] w-9 h-9 text-[var(--color-secondary)] mx-auto mb-2">account_balance_wallet</mat-icon>
              <h4 class="font-editorial text-lg font-semibold text-[var(--color-ink)]">
                Select an Account
              </h4>
              <p class="text-xs text-[var(--color-secondary)] mt-1 max-w-sm mx-auto">
                Choose an account on the left to inspect opening balances, statement history, and run reconciliations.
              </p>
            </div>
          }
        </div>
      </div>

      <!-- ============================================== -->
      <!-- MODAL: CREATE ACCOUNT                         -->
      <!-- ============================================== -->
      @if (showCreateModal()) {
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden select-none">
            <div class="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-xl font-bold text-[var(--color-ink)]">
                  Create Financial Account
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Establish a bank account or canonical cash custody ledger.
                </p>
              </div>
              <button
                type="button"
                (click)="closeCreateModal()"
                class="p-1 rounded-lg hover:bg-[var(--color-canvas)] text-[var(--color-secondary)] cursor-pointer"
              >
                <mat-icon class="text-[20px] w-5 h-5">close</mat-icon>
              </button>
            </div>

            <form [formGroup]="createForm" (ngSubmit)="submitCreate()" class="p-6 space-y-4">
              <!-- Account Type -->
              <div>
                <span class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Account Type
                </span>
                <div class="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    (click)="setCreateType('bank')"
                    [class.border-[var(--color-accent)]]="createForm.get('type')?.value === 'bank'"
                    [class.bg-[var(--color-canvas)]]="createForm.get('type')?.value === 'bank'"
                    class="p-3 border rounded-xl text-left border-[var(--color-border)] transition-colors cursor-pointer"
                  >
                    <div class="flex items-center space-x-2">
                      <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-accent)]">account_balance</mat-icon>
                      <span class="text-xs font-semibold text-[var(--color-ink)]">Bank Account</span>
                    </div>
                    <p class="text-[10px] text-[var(--color-secondary)] mt-1">Savings, checking, or payroll accounts.</p>
                  </button>

                  <button
                    type="button"
                    [disabled]="accountState.hasCashAccount()"
                    (click)="setCreateType('cash')"
                    [class.opacity-50]="accountState.hasCashAccount()"
                    [class.cursor-not-allowed]="accountState.hasCashAccount()"
                    [class.border-[var(--color-accent)]]="createForm.get('type')?.value === 'cash'"
                    [class.bg-[var(--color-canvas)]]="createForm.get('type')?.value === 'cash'"
                    class="p-3 border rounded-xl text-left border-[var(--color-border)] transition-colors cursor-pointer"
                  >
                    <div class="flex items-center space-x-2">
                      <mat-icon class="text-[18px] w-[18px] h-[18px] text-emerald-600">payments</mat-icon>
                      <span class="text-xs font-semibold text-[var(--color-ink)]">Canonical Cash</span>
                    </div>
                    <p class="text-[10px] text-[var(--color-secondary)] mt-1">
                      {{ accountState.hasCashAccount() ? 'Already configured (Max 1)' : 'Physical cash and wallet.' }}
                    </p>
                  </button>
                </div>
              </div>

              <!-- Name -->
              <div>
                <label for="create-name" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Account Name <span class="text-red-500">*</span>
                </label>
                <input
                  id="create-name"
                  type="text"
                  formControlName="name"
                  placeholder="e.g. HDFC Salary Account, Physical Wallet"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <!-- Institution & Currency -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="create-institution" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Institution / Custody
                  </label>
                  <input
                    id="create-institution"
                    type="text"
                    formControlName="institution"
                    placeholder="e.g. HDFC Bank, Physical Cash"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                </div>

                <div>
                  <label for="create-currency" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Currency (ISO) <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="create-currency"
                    type="text"
                    formControlName="currency"
                    maxlength="3"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] uppercase font-mono focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              <!-- Opening Balance & Date -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="create-openingBalance" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Opening Balance <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="create-openingBalance"
                    type="number"
                    step="0.01"
                    formControlName="openingBalanceMajor"
                    placeholder="0.00"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] tabular-nums focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                  <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Stored as integer minor units</span>
                </div>

                <div>
                  <label for="create-openingDate" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Effective Date <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="create-openingDate"
                    type="date"
                    formControlName="openingBalanceDate"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              <!-- Footer Actions -->
              <div class="pt-4 border-t border-[var(--color-border)] flex items-center justify-end space-x-3">
                <button
                  type="button"
                  (click)="closeCreateModal()"
                  class="px-4 py-2 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  [disabled]="createForm.invalid || accountState.actionLoading()"
                  class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
                >
                  @if (accountState.actionLoading()) {
                    <mat-icon class="animate-spin text-[16px] w-4 h-4">sync</mat-icon>
                    <span>Creating...</span>
                  } @else {
                    <mat-icon class="text-[16px] w-4 h-4">check</mat-icon>
                    <span>Create Account</span>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ============================================== -->
      <!-- MODAL: EDIT ACCOUNT                           -->
      <!-- ============================================== -->
      @if (showEditModal() && editingAccount()) {
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden select-none">
            <div class="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-xl font-bold text-[var(--color-ink)]">
                  Edit Account Details
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Update account parameters or adjust opening balance ledger base.
                </p>
              </div>
              <button
                type="button"
                (click)="closeEditModal()"
                class="p-1 rounded-lg hover:bg-[var(--color-canvas)] text-[var(--color-secondary)] cursor-pointer"
              >
                <mat-icon class="text-[20px] w-5 h-5">close</mat-icon>
              </button>
            </div>

            <form [formGroup]="editForm" (ngSubmit)="submitEdit()" class="p-6 space-y-4">
              <!-- Name -->
              <div>
                <label for="edit-name" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Account Name <span class="text-red-500">*</span>
                </label>
                <input
                  id="edit-name"
                  type="text"
                  formControlName="name"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <!-- Institution -->
              <div>
                <label for="edit-institution" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Institution / Custody Label
                </label>
                <input
                  id="edit-institution"
                  type="text"
                  formControlName="institution"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <!-- Opening Balance & Date -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="edit-openingBalance" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Opening Balance
                  </label>
                  <input
                    id="edit-openingBalance"
                    type="number"
                    step="0.01"
                    formControlName="openingBalanceMajor"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] tabular-nums focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                  <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Changing this generates an audit log</span>
                </div>

                <div>
                  <label for="edit-openingDate" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Effective Date
                  </label>
                  <input
                    id="edit-openingDate"
                    type="date"
                    formControlName="openingBalanceDate"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              <!-- Status Toggle -->
              <div class="pt-2">
                <label for="edit-isActive" class="flex items-center space-x-2 text-xs text-[var(--color-ink)] cursor-pointer select-none">
                  <input
                    id="edit-isActive"
                    type="checkbox"
                    formControlName="isActive"
                    class="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                  />
                  <span>Account is Active (participates in portfolio liquidity)</span>
                </label>
              </div>

              <!-- Footer Actions -->
              <div class="pt-4 border-t border-[var(--color-border)] flex items-center justify-end space-x-3">
                <button
                  type="button"
                  (click)="closeEditModal()"
                  class="px-4 py-2 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  [disabled]="editForm.invalid || accountState.actionLoading()"
                  class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
                >
                  @if (accountState.actionLoading()) {
                    <mat-icon class="animate-spin text-[16px] w-4 h-4">sync</mat-icon>
                    <span>Saving...</span>
                  } @else {
                    <mat-icon class="text-[16px] w-4 h-4">check</mat-icon>
                    <span>Save Changes</span>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ============================================== -->
      <!-- MODAL: RECONCILE ACCOUNT                      -->
      <!-- ============================================== -->
      @if (showReconcileModal() && reconcilingAccount()) {
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden select-none">
            <div class="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h3 class="font-editorial text-xl font-bold text-[var(--color-ink)]">
                  Reconcile {{ reconcilingAccount()!.name }}
                </h3>
                <p class="text-xs text-[var(--color-secondary)] mt-0.5">
                  Capture external reported balance snapshot and compare variance.
                </p>
              </div>
              <button
                type="button"
                (click)="closeReconcileModal()"
                class="p-1 rounded-lg hover:bg-[var(--color-canvas)] text-[var(--color-secondary)] cursor-pointer"
              >
                <mat-icon class="text-[20px] w-5 h-5">close</mat-icon>
              </button>
            </div>

            <form [formGroup]="reconcileForm" (ngSubmit)="submitReconcile()" class="p-6 space-y-4">
              <!-- Balance Comparison Matrix -->
              <div class="bg-[var(--color-canvas)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-[var(--color-secondary)]">Current Calculated Balance:</span>
                  <span class="font-editorial font-bold text-[var(--color-ink)] tabular-nums text-sm">
                    {{ formatCurrency(reconcilingAccount()!.calculatedBalance, reconcilingAccount()!.currency) }}
                  </span>
                </div>

                <div class="flex items-center justify-between text-xs pt-2 border-t border-[var(--color-border)]/60">
                  <span class="text-[var(--color-secondary)]">Statement / Reported Balance:</span>
                  <span class="font-editorial font-bold text-[var(--color-ink)] tabular-nums text-sm">
                    {{ formatCurrency(getLiveReportedPaise(), reconcilingAccount()!.currency) }}
                  </span>
                </div>

                @let diff = getLiveReconcileDifference();
                <div class="flex items-center justify-between text-xs pt-2 border-t border-[var(--color-border)]/60">
                  <span class="font-semibold text-[var(--color-ink)]">Difference (Reported − Calculated):</span>
                  <span
                    [class.text-emerald-700]="diff === 0"
                    [class.dark:text-emerald-400]="diff === 0"
                    [class.text-amber-700]="diff !== 0"
                    [class.dark:text-amber-400]="diff !== 0"
                    class="font-editorial font-bold tabular-nums text-sm"
                  >
                    {{ diff > 0 ? '+' : '' }}{{ formatCurrency(diff, reconcilingAccount()!.currency) }}
                  </span>
                </div>
              </div>

              <!-- Reported Balance Input -->
              <div>
                <label for="reconcile-reportedBalance" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Reported Statement Balance <span class="text-red-500">*</span>
                </label>
                <input
                  id="reconcile-reportedBalance"
                  type="number"
                  step="0.01"
                  formControlName="reportedBalanceMajor"
                  placeholder="0.00"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] tabular-nums focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              <!-- Date & Source -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="reconcile-snapshotDate" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Statement Date <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="reconcile-snapshotDate"
                    type="date"
                    formControlName="snapshotDate"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono focus:outline-hidden focus:border-[var(--color-accent)]"
                  />
                </div>

                <div>
                  <label for="reconcile-source" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Source
                  </label>
                  <select
                    id="reconcile-source"
                    formControlName="source"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                  >
                    <option value="bank_statement">Bank Statement</option>
                    <option value="physical_count">Physical Cash Count</option>
                    <option value="portal">Online Portal / App</option>
                    <option value="manual">Manual Verification</option>
                  </select>
                </div>
              </div>

              <!-- Notes -->
              <div>
                <label for="reconcile-notes" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Auditor Notes
                </label>
                <textarea
                  id="reconcile-notes"
                  rows="2"
                  formControlName="notes"
                  placeholder="e.g. End of month statement reconciliation..."
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                ></textarea>
              </div>

              <!-- Adjustment Option if Difference != 0 -->
              @if (getLiveReconcileDifference() !== 0) {
                <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <div class="flex items-start space-x-2">
                    <mat-icon class="text-[18px] w-[18px] h-[18px] text-amber-700 dark:text-amber-400 shrink-0 mt-0.5">warning</mat-icon>
                    <p class="text-xs text-amber-900 dark:text-amber-200 leading-snug">
                      A discrepancy of <span class="font-bold tabular-nums font-mono">{{ formatCurrency(getLiveReconcileDifference(), reconcilingAccount()!.currency) }}</span> was detected.
                    </p>
                  </div>
                  <label for="reconcile-applyAdjustment" class="flex items-center space-x-2 text-xs text-[var(--color-ink)] cursor-pointer select-none pl-6">
                    <input
                      id="reconcile-applyAdjustment"
                      type="checkbox"
                      formControlName="applyAdjustment"
                      class="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    <span class="font-medium">Apply reconciliation adjustment to align calculated balance with external record.</span>
                  </label>
                  <p class="text-[10px] text-[var(--color-secondary)] pl-6">
                    If unchecked, the snapshot is recorded for audit history, but your calculated balance remains untouched.
                  </p>
                </div>
              }

              <!-- Footer Actions -->
              <div class="pt-4 border-t border-[var(--color-border)] flex items-center justify-end space-x-3">
                <button
                  type="button"
                  (click)="closeReconcileModal()"
                  class="px-4 py-2 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  [disabled]="reconcileForm.invalid || accountState.actionLoading()"
                  class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
                >
                  @if (accountState.actionLoading()) {
                    <mat-icon class="animate-spin text-[16px] w-4 h-4">sync</mat-icon>
                    <span>Reconciling...</span>
                  } @else {
                    <mat-icon class="text-[16px] w-4 h-4">fact_check</mat-icon>
                    <span>Confirm & Reconcile</span>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class Accounts implements OnInit {
  readonly accountState = inject(AccountState);

  // Modal State Signals
  readonly showCreateModal = signal<boolean>(false);
  readonly showEditModal = signal<boolean>(false);
  readonly showReconcileModal = signal<boolean>(false);

  readonly editingAccount = signal<Account | null>(null);
  readonly reconcilingAccount = signal<Account | null>(null);

  // Reactive Forms
  readonly createForm = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    type: new FormControl<'bank' | 'cash'>('bank', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    institution: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    currency: new FormControl<string>('INR', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)],
    }),
    openingBalanceMajor: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    openingBalanceDate: new FormControl<string>(new Date().toISOString().split('T')[0], {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  readonly editForm = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    institution: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    openingBalanceMajor: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    openingBalanceDate: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    isActive: new FormControl<boolean>(true, {
      nonNullable: true,
    }),
  });

  readonly reconcileForm = new FormGroup({
    reportedBalanceMajor: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    snapshotDate: new FormControl<string>(new Date().toISOString().split('T')[0], {
      nonNullable: true,
      validators: [Validators.required],
    }),
    source: new FormControl<string>('bank_statement', {
      nonNullable: true,
    }),
    notes: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    applyAdjustment: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
  });

  ngOnInit(): void {
    this.accountState.loadAccounts();
  }

  formatCurrency(minorUnits: number | null | undefined, currency = 'INR'): string {
    return formatMinorUnits(minorUnits, currency);
  }

  formatDate(isoDateStr?: string | null): string {
    if (!isoDateStr) return 'Never';
    try {
      const d = new Date(isoDateStr);
      return d.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoDateStr;
    }
  }

  getVariance(account: Account): number | null {
    if (account.reportedBalance === null || account.reportedBalance === undefined) {
      return null;
    }
    return account.reportedBalance - account.calculatedBalance;
  }

  getLiveReportedPaise(): number {
    const val = this.reconcileForm.get('reportedBalanceMajor')?.value ?? 0;
    return toMinorUnits(val);
  }

  getLiveReconcileDifference(): number {
    const acc = this.reconcilingAccount();
    if (!acc) return 0;
    const reported = this.getLiveReportedPaise();
    return reported - acc.calculatedBalance;
  }

  // Create Modal Actions
  openCreateModal(defaultType: 'bank' | 'cash' = 'bank'): void {
    this.createForm.reset({
      name: '',
      type: defaultType,
      institution: defaultType === 'cash' ? 'Cash Custody' : '',
      currency: 'INR',
      openingBalanceMajor: 0,
      openingBalanceDate: new Date().toISOString().split('T')[0],
    });
    this.showCreateModal.set(true);
  }

  openCreateCashModal(): void {
    this.openCreateModal('cash');
  }

  setCreateType(type: 'bank' | 'cash'): void {
    if (type === 'cash' && this.accountState.hasCashAccount()) {
      return;
    }
    this.createForm.patchValue({
      type,
      institution: type === 'cash' ? 'Cash Custody' : '',
      name: type === 'cash' && !this.createForm.get('name')?.value ? 'Physical Cash' : this.createForm.get('name')?.value,
    });
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  async submitCreate(): Promise<void> {
    if (this.createForm.invalid) return;

    const val = this.createForm.getRawValue();
    try {
      await this.accountState.createAccount({
        name: val.name,
        type: val.type,
        institution: val.institution,
        currency: val.currency.toUpperCase(),
        openingBalance: toMinorUnits(val.openingBalanceMajor),
        openingBalanceDate: val.openingBalanceDate,
      });
      this.closeCreateModal();
    } catch {
      // Handled in store error signal
    }
  }

  // Edit Modal Actions
  openEditModal(account: Account): void {
    this.editingAccount.set(account);
    this.editForm.reset({
      name: account.name,
      institution: account.institution,
      openingBalanceMajor: toMajorUnits(account.openingBalance),
      openingBalanceDate: account.openingBalanceDate,
      isActive: account.isActive,
    });
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.editingAccount.set(null);
  }

  async submitEdit(): Promise<void> {
    const acc = this.editingAccount();
    if (!acc || this.editForm.invalid) return;

    const val = this.editForm.getRawValue();
    try {
      await this.accountState.updateAccount(acc.id, {
        name: val.name,
        institution: val.institution,
        openingBalance: toMinorUnits(val.openingBalanceMajor),
        openingBalanceDate: val.openingBalanceDate,
        isActive: val.isActive,
      });
      this.closeEditModal();
    } catch {
      // Handled in store error signal
    }
  }

  // Reconcile Modal Actions
  openReconcileModal(account: Account): void {
    this.reconcilingAccount.set(account);
    const existingReportedMajor = account.reportedBalance !== null && account.reportedBalance !== undefined
      ? toMajorUnits(account.reportedBalance)
      : toMajorUnits(account.calculatedBalance);

    this.reconcileForm.reset({
      reportedBalanceMajor: existingReportedMajor,
      snapshotDate: new Date().toISOString().split('T')[0],
      source: account.type === 'cash' ? 'physical_count' : 'bank_statement',
      notes: '',
      applyAdjustment: false,
    });
    this.showReconcileModal.set(true);
  }

  closeReconcileModal(): void {
    this.showReconcileModal.set(false);
    this.reconcilingAccount.set(null);
  }

  async submitReconcile(): Promise<void> {
    const acc = this.reconcilingAccount();
    if (!acc || this.reconcileForm.invalid) return;

    const val = this.reconcileForm.getRawValue();
    try {
      await this.accountState.reconcile(acc.id, {
        reportedBalance: toMinorUnits(val.reportedBalanceMajor),
        snapshotDate: val.snapshotDate,
        source: val.source,
        notes: val.notes,
        applyAdjustment: val.applyAdjustment,
      });
      this.closeReconcileModal();
    } catch {
      // Handled in store error signal
    }
  }
}
