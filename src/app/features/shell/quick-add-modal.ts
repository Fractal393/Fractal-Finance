import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TransactionState } from '../../core/transactions/transaction-state';
import { AccountState } from '../../core/accounts/account-state';
import {
  TransactionType,
  TRANSACTION_TYPE_LABELS,
} from '../../core/transactions/transaction-models';
import { toMinorUnits } from '../../core/accounts/account-models';

interface SplitRow {
  categoryId: string;
  amountMajor: number | null;
  notes: string;
}

@Component({
  selector: 'app-quick-add-modal',
  imports: [ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 select-none">
        <div class="w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] overflow-hidden">
          <!-- Modal Header -->
          <div class="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
            <div class="flex items-center space-x-2">
              <span class="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)]"></span>
              <h3 class="font-editorial text-lg font-bold text-[var(--color-ink)]">
                Record Financial Movement
              </h3>
            </div>
            <button
              type="button"
              (click)="onCancel()"
              class="p-1.5 rounded-lg text-[var(--color-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
            >
              <mat-icon class="text-[20px] w-5 h-5">close</mat-icon>
            </button>
          </div>

          <!-- Modal Scrollable Body -->
          <form [formGroup]="form" class="p-5 space-y-4 overflow-y-auto flex-1">
            <!-- 1. Amount (Prominent numeric input) -->
            <div>
              <label for="qa-amount" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                Amount <span class="text-red-500">*</span>
              </label>
              <div class="relative">
                <span class="absolute left-3.5 top-1/2 -translate-y-1/2 font-editorial text-lg text-[var(--color-secondary)]">
                  ₹
                </span>
                <input
                  id="qa-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  formControlName="amountMajor"
                  placeholder="0.00"
                  class="w-full pl-8 pr-4 py-2.5 text-base sm:text-lg font-editorial font-bold tabular-nums rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>
              <span class="text-[10px] text-[var(--color-secondary)] mt-0.5 block">Stored as integer minor units (paise)</span>
            </div>

            <!-- 2. Type Selector -->
            <div>
              <label for="qa-type" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                Transaction Classification <span class="text-red-500">*</span>
              </label>
              <select
                id="qa-type"
                formControlName="type"
                class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)] font-medium"
              >
                @for (entry of typeOptions; track entry.key) {
                  <option [value]="entry.key">
                    {{ entry.label }} ({{ entry.cashImpact }})
                  </option>
                }
              </select>
            </div>

            <!-- 3. Account(s) -->
            @if (isTransfer()) {
              <!-- Paired Internal Transfer Source & Destination -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]">
                <div>
                  <label for="qa-sourceAccount" class="block text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Debit Source Account <span class="text-red-500">*</span>
                  </label>
                  <select
                    id="qa-sourceAccount"
                    formControlName="accountId"
                    class="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                  >
                    @for (acc of accountState.accounts(); track acc.id) {
                      <option [value]="acc.id">
                        {{ acc.name }} ({{ acc.currency }} • {{ acc.type }})
                      </option>
                    }
                  </select>
                </div>

                <div>
                  <label for="qa-destAccount" class="block text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Credit Destination Account <span class="text-red-500">*</span>
                  </label>
                  <select
                    id="qa-destAccount"
                    formControlName="destinationAccountId"
                    class="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                  >
                    <option value="">Select destination...</option>
                    @for (acc of accountState.accounts(); track acc.id) {
                      <option [value]="acc.id" [disabled]="acc.id === form.get('accountId')?.value">
                        {{ acc.name }} ({{ acc.currency }} • {{ acc.type }})
                      </option>
                    }
                  </select>
                </div>
              </div>
            } @else {
              <!-- Standard Single Account -->
              <div>
                <label for="qa-account" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Account <span class="text-red-500">*</span>
                </label>
                <select
                  id="qa-account"
                  formControlName="accountId"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                >
                  @for (acc of accountState.accounts(); track acc.id) {
                    <option [value]="acc.id">
                      {{ acc.name }} ({{ acc.currency }} • {{ acc.type }})
                    </option>
                  }
                </select>
              </div>
            }

            <!-- 4. Category (Hidden for transfers, supports Split) -->
            @if (!isTransfer()) {
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label for="qa-category" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">
                    Category
                  </label>
                  <button
                    type="button"
                    (click)="toggleSplit()"
                    class="text-[11px] text-[var(--color-accent)] hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <mat-icon class="text-[14px] w-3.5 h-3.5">
                      {{ isSplit() ? 'check_box' : 'call_split' }}
                    </mat-icon>
                    <span>{{ isSplit() ? 'Use Single Category' : 'Split Across Categories' }}</span>
                  </button>
                </div>

                @if (!isSplit()) {
                  <select
                    id="qa-category"
                    formControlName="categoryId"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                  >
                    <option value="">No category assigned</option>
                    @for (cat of txState.activeCategories(); track cat.id) {
                      <option [value]="cat.id">
                        {{ cat.parentId ? '— ' + cat.name : cat.name }} ({{ cat.type }})
                      </option>
                    }
                  </select>
                } @else {
                  <!-- Split Allocation Sub-Form -->
                  <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] space-y-3">
                    <div class="flex items-center justify-between text-xs">
                      <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)]">Split Allocations</span>
                      <div class="text-right tabular-nums">
                        <span class="text-[11px] text-[var(--color-secondary)]">Allocated: </span>
                        <span [class.text-emerald-700]="isSplitBalanced()" [class.text-amber-700]="!isSplitBalanced()" class="font-mono font-bold text-xs">
                          ₹{{ formatMajorUnits(splitSum()) }} / ₹{{ formatMajorUnits(form.get('amountMajor')?.value || 0) }}
                        </span>
                      </div>
                    </div>

                    @for (row of splitRows(); track $index) {
                      <div class="flex items-center space-x-2">
                        <select
                          [value]="row.categoryId"
                          (change)="updateSplitCategory($index, $any($event.target).value)"
                          class="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)]"
                        >
                          <option value="">Select category...</option>
                          @for (cat of txState.activeCategories(); track cat.id) {
                            <option [value]="cat.id">{{ cat.name }}</option>
                          }
                        </select>

                        <input
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          [value]="row.amountMajor"
                          (input)="updateSplitAmount($index, $any($event.target).value)"
                          class="w-24 px-2 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)] tabular-nums"
                        />

                        <button
                          type="button"
                          (click)="removeSplitRow($index)"
                          class="p-1 text-[var(--color-secondary)] hover:text-red-600 cursor-pointer"
                        >
                          <mat-icon class="text-[16px] w-4 h-4">delete</mat-icon>
                        </button>
                      </div>
                    }

                    <button
                      type="button"
                      (click)="addSplitRow()"
                      class="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center space-x-1 cursor-pointer"
                    >
                      <mat-icon class="text-[14px] w-3.5 h-3.5">add</mat-icon>
                      <span>Add Allocation Row</span>
                    </button>
                  </div>
                }
              </div>
            }

            <!-- 5. Date & Counterparty -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label for="qa-date" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                  Transaction Date <span class="text-red-500">*</span>
                </label>
                <input
                  id="qa-date"
                  type="date"
                  formControlName="transactionDate"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono focus:outline-hidden focus:border-[var(--color-accent)]"
                />
              </div>

              @if (!isTransfer()) {
                <div>
                  <label for="qa-counterparty" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Counterparty / Merchant
                  </label>
                  <div class="flex items-center space-x-1">
                    <select
                      id="qa-counterparty"
                      formControlName="counterpartyId"
                      class="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                    >
                      <option value="">None / Unassigned</option>
                      @for (cp of txState.activeCounterparties(); track cp.id) {
                        <option [value]="cp.id">{{ cp.name }}</option>
                      }
                    </select>
                    <button
                      type="button"
                      (click)="showNewCpPrompt()"
                      title="Add Counterparty"
                      class="p-2 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] text-[var(--color-secondary)] cursor-pointer"
                    >
                      <mat-icon class="text-[16px] w-4 h-4">add</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- 6. Description -->
            <div>
              <label for="qa-desc" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                Description <span class="text-red-500">*</span>
              </label>
              <input
                id="qa-desc"
                type="text"
                formControlName="description"
                placeholder="e.g. Monthly Grocery Restock, Salary Credit"
                class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
              />
            </div>

            <!-- 7. More Details Accordion / Toggle -->
            <div>
              <button
                type="button"
                (click)="showMoreDetails.set(!showMoreDetails())"
                class="text-xs text-[var(--color-secondary)] hover:text-[var(--color-ink)] inline-flex items-center space-x-1 cursor-pointer"
              >
                <mat-icon class="text-[16px] w-4 h-4">
                  {{ showMoreDetails() ? 'expand_less' : 'tune' }}
                </mat-icon>
                <span>{{ showMoreDetails() ? 'Hide Additional Details' : 'More Details (Tags & Notes)' }}</span>
              </button>

              @if (showMoreDetails()) {
                <div class="mt-2 space-y-3 pt-2 border-t border-[var(--color-border)]/60">
                  <div>
                    <label for="qa-tags" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Tags (Comma Separated)
                    </label>
                    <input
                      id="qa-tags"
                      type="text"
                      formControlName="tagsInput"
                      placeholder="e.g. travel, tax-deductible, personal"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                    />
                  </div>

                  <div>
                    <label for="qa-notes" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Notes
                    </label>
                    <textarea
                      id="qa-notes"
                      rows="2"
                      formControlName="notes"
                      placeholder="Optional memo or invoice details..."
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                    ></textarea>
                  </div>
                </div>
              }
            </div>

            <!-- Error banner if any -->
            @if (localError()) {
              <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs">
                {{ localError() }}
              </div>
            }
          </form>

          <!-- Modal Footer Actions -->
          <div class="px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-canvas)] flex flex-wrap items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              (click)="onCancel()"
              class="px-3.5 py-1.5 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <div class="flex items-center space-x-2">
              <button
                type="button"
                [disabled]="isFormInvalid() || txState.actionLoading()"
                (click)="submitForm(true)"
                class="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Save & Add Another
              </button>

              <button
                type="button"
                [disabled]="isFormInvalid() || txState.actionLoading()"
                (click)="submitForm(false)"
                class="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
              >
                @if (txState.actionLoading()) {
                  <mat-icon class="animate-spin text-[16px] w-4 h-4">sync</mat-icon>
                  <span>Saving...</span>
                } @else {
                  <mat-icon class="text-[16px] w-4 h-4">check</mat-icon>
                  <span>Save</span>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class QuickAddModal implements OnInit {
  readonly isOpen = input<boolean>(false);
  readonly closed = output<void>();

  readonly txState = inject(TransactionState);
  readonly accountState = inject(AccountState);

  readonly isSplit = signal<boolean>(false);
  readonly showMoreDetails = signal<boolean>(false);
  readonly localError = signal<string | null>(null);
  readonly splitRows = signal<SplitRow[]>([]);

  readonly typeOptions = (Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((key) => ({
    key,
    ...TRANSACTION_TYPE_LABELS[key],
  }));

  readonly form = new FormGroup({
    amountMajor: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    type: new FormControl<TransactionType>('EXPENSE', [Validators.required]),
    accountId: new FormControl<string>('', [Validators.required]),
    destinationAccountId: new FormControl<string>(''),
    categoryId: new FormControl<string>(''),
    counterpartyId: new FormControl<string>(''),
    transactionDate: new FormControl<string>(new Date().toISOString().split('T')[0], [Validators.required]),
    description: new FormControl<string>('', [Validators.required, Validators.maxLength(200)]),
    tagsInput: new FormControl<string>(''),
    notes: new FormControl<string>(''),
  });

  readonly isTransfer = computed(() => {
    return this.form.get('type')?.value === 'INTERNAL_TRANSFER';
  });

  readonly splitSum = computed(() => {
    return this.splitRows().reduce((acc, r) => acc + (r.amountMajor || 0), 0);
  });

  readonly isSplitBalanced = computed(() => {
    const total = this.form.get('amountMajor')?.value || 0;
    return Math.abs(this.splitSum() - total) < 0.001;
  });

  ngOnInit(): void {
    // Ensure metadata and accounts are loaded
    if (this.accountState.accounts().length === 0) {
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Accounts load skipped:', err);
      });
    }
    if (this.txState.categories().length === 0) {
      this.txState.loadMetadata().catch((err: unknown) => {
        console.warn('Metadata load skipped:', err);
      });
    }

    // Set initial account default
    const accounts = this.accountState.accounts();
    if (accounts.length > 0) {
      this.form.patchValue({ accountId: accounts[0].id });
    }
  }

  isFormInvalid(): boolean {
    if (this.form.invalid) return true;
    if (this.isTransfer()) {
      const src = this.form.get('accountId')?.value;
      const dest = this.form.get('destinationAccountId')?.value;
      if (!dest || src === dest) return true;
    }
    if (this.isSplit()) {
      if (this.splitRows().length < 2 || !this.isSplitBalanced()) return true;
      if (this.splitRows().some((r) => !r.categoryId || !r.amountMajor || r.amountMajor <= 0)) return true;
    }
    return false;
  }

  toggleSplit(): void {
    const next = !this.isSplit();
    this.isSplit.set(next);
    if (next && this.splitRows().length === 0) {
      const total = this.form.get('amountMajor')?.value || 0;
      const half = total > 0 ? parseFloat((total / 2).toFixed(2)) : 0;
      const rem = total > 0 ? parseFloat((total - half).toFixed(2)) : 0;
      this.splitRows.set([
        { categoryId: '', amountMajor: half, notes: '' },
        { categoryId: '', amountMajor: rem, notes: '' },
      ]);
    }
  }

  addSplitRow(): void {
    this.splitRows.update((prev) => [...prev, { categoryId: '', amountMajor: null, notes: '' }]);
  }

  removeSplitRow(index: number): void {
    this.splitRows.update((prev) => prev.filter((_, i) => i !== index));
  }

  updateSplitCategory(index: number, catId: string): void {
    this.splitRows.update((prev) =>
      prev.map((r, i) => (i === index ? { ...r, categoryId: catId } : r))
    );
  }

  updateSplitAmount(index: number, val: string): void {
    const num = parseFloat(val) || 0;
    this.splitRows.update((prev) =>
      prev.map((r, i) => (i === index ? { ...r, amountMajor: num } : r))
    );
  }

  formatMajorUnits(num: number): string {
    return (num || 0).toFixed(2);
  }

  async showNewCpPrompt(): Promise<void> {
    const name = window.prompt('Enter new counterparty name:');
    if (name && name.trim()) {
      try {
        const cp = await this.txState.addCounterparty(name.trim());
        this.form.patchValue({ counterpartyId: cp.id });
      } catch (err: unknown) {
        this.localError.set(err instanceof Error ? err.message : 'Failed to add counterparty');
      }
    }
  }

  async submitForm(addAnother: boolean): Promise<void> {
    this.localError.set(null);
    const v = this.form.value;
    if (!v.amountMajor || !v.accountId || !v.transactionDate || !v.description) {
      this.localError.set('Please fill out all required fields.');
      return;
    }

    const minorUnits = toMinorUnits(v.amountMajor);

    // Tags array parsing
    const tags = (v.tagsInput || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    try {
      if (v.type === 'INTERNAL_TRANSFER') {
        if (!v.destinationAccountId) {
          this.localError.set('Destination account is required for transfer.');
          return;
        }
        await this.txState.createTransfer({
          sourceAccountId: v.accountId,
          destinationAccountId: v.destinationAccountId,
          amount: minorUnits,
          transactionDate: v.transactionDate,
          description: v.description,
          notes: v.notes || '',
          tags,
        });
      } else {
        // Standard or split
        let allocations: { categoryId: string; amount: number; tags?: string[]; notes?: string }[] | undefined;
        if (this.isSplit()) {
          allocations = this.splitRows().map((r) => ({
            categoryId: r.categoryId,
            amount: toMinorUnits(r.amountMajor || 0),
            notes: r.notes || '',
          }));
        }

        await this.txState.createTransaction({
          accountId: v.accountId,
          amount: minorUnits,
          type: v.type!,
          categoryId: this.isSplit() ? null : v.categoryId || null,
          counterpartyId: v.counterpartyId || null,
          transactionDate: v.transactionDate,
          description: v.description,
          tags,
          notes: v.notes || '',
          allocations,
        });
      }

      if (addAnother) {
        // Reset amount and description for next transaction
        this.form.patchValue({
          amountMajor: null,
          description: '',
          notes: '',
        });
        this.isSplit.set(false);
        this.splitRows.set([]);
      } else {
        this.closed.emit();
      }
    } catch (err: unknown) {
      this.localError.set(err instanceof Error ? err.message : 'Failed to record transaction');
    }
  }

  onCancel(): void {
    this.localError.set(null);
    this.closed.emit();
  }
}
