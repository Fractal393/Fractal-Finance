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
  Transaction,
  TransactionType,
  TRANSACTION_TYPE_LABELS,
} from '../../core/transactions/transaction-models';
import { toMinorUnits, toMajorUnits, formatMinorUnits } from '../../core/accounts/account-models';

interface SplitRow {
  categoryId: string;
  amountMajor: number | null;
  notes: string;
}

@Component({
  selector: 'app-transaction-edit-modal',
  imports: [ReactiveFormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (transaction(); as tx) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 select-none">
        <div class="w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
          <!-- Header -->
          <div class="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
            <div class="flex items-center space-x-2">
              <span class="w-2.5 h-2.5 rounded-full" [class.bg-emerald-600]="tx.status === 'POSTED'" [class.bg-red-500]="tx.status === 'VOIDED'"></span>
              <h3 class="font-editorial text-lg font-bold text-[var(--color-ink)]">
                {{ isEditing() ? 'Edit Transaction' : 'Transaction Details' }}
              </h3>
              @if (tx.status === 'VOIDED') {
                <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-red-500/10 text-red-600 border border-red-500/20">
                  Voided
                </span>
              }
            </div>
            <button
              type="button"
              (click)="closed.emit()"
              class="p-1.5 rounded-lg text-[var(--color-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas)] transition-colors cursor-pointer"
            >
              <mat-icon class="text-[20px] w-5 h-5">close</mat-icon>
            </button>
          </div>

          <!-- Body -->
          <div class="p-5 space-y-4 overflow-y-auto flex-1">
            @if (tx.status === 'VOIDED') {
              <!-- Void Information Alert -->
              <div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs space-y-1">
                <div class="font-medium text-red-700 dark:text-red-400 flex items-center space-x-1.5">
                  <mat-icon class="text-[16px] w-4 h-4">block</mat-icon>
                  <span>This transaction has been voided.</span>
                </div>
                <p class="text-red-600/90 dark:text-red-300">
                  Reason: {{ tx.voidReason || 'No reason specified' }}
                </p>
                <p class="text-[11px] font-mono text-red-600/80">
                  Voided on: {{ tx.voidedAt }}
                </p>
              </div>
            }

            @if (!isEditing()) {
              <!-- READ-ONLY VIEW MODE -->
              <div class="space-y-4">
                <!-- Large Amount Display -->
                <div class="p-4 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] flex items-center justify-between">
                  <div>
                    <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)]">
                      Classification & Type
                    </span>
                    <div class="font-medium text-sm text-[var(--color-ink)] mt-0.5 flex items-center space-x-1.5">
                      <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-accent)]">
                        {{ typeMeta.icon }}
                      </mat-icon>
                      <span>{{ typeMeta.label }}</span>
                      <span class="text-xs text-[var(--color-secondary)] font-mono">({{ typeMeta.cashImpact }})</span>
                    </div>
                  </div>

                  <div class="text-right">
                    <span class="text-[11px] font-mono uppercase tracking-wider text-[var(--color-secondary)]">
                      Amount
                    </span>
                    <div class="font-editorial text-2xl font-bold tabular-nums" [class.text-red-600]="tx.type === 'EXPENSE' || tx.type === 'TAX'" [class.text-emerald-600]="tx.type === 'INCOME'">
                      ₹{{ formatMinor(tx.amount) }}
                    </div>
                  </div>
                </div>

                <!-- Attributes Grid -->
                <div class="grid grid-cols-2 gap-3 text-xs">
                  <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]">
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-1">Account</span>
                    <span class="font-medium text-[var(--color-ink)]">{{ getAccountName(tx.accountId) }}</span>
                    @if (tx.destinationAccountId) {
                      <div class="mt-1 text-[11px] text-[var(--color-secondary)]">
                        Paired with: {{ getAccountName(tx.destinationAccountId) }}
                      </div>
                    }
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]">
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-1">Date</span>
                    <span class="font-mono font-medium text-[var(--color-ink)]">{{ tx.transactionDate }}</span>
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]">
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-1">Category</span>
                    <span class="font-medium text-[var(--color-ink)]">{{ getCategoryName(tx.categoryId) }}</span>
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)]">
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-1">Counterparty</span>
                    <span class="font-medium text-[var(--color-ink)]">{{ getCounterpartyName(tx.counterpartyId) }}</span>
                  </div>
                </div>

                <!-- Description & Notes -->
                <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] space-y-2 text-xs">
                  <div>
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-0.5">Description</span>
                    <p class="font-medium text-[var(--color-ink)]">{{ tx.description }}</p>
                  </div>
                  @if (tx.notes) {
                    <div>
                      <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-0.5">Notes</span>
                      <p class="text-[var(--color-secondary)]">{{ tx.notes }}</p>
                    </div>
                  }
                  @if (tx.tags && tx.tags.length > 0) {
                    <div>
                      <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block mb-1">Tags</span>
                      <div class="flex flex-wrap gap-1.5">
                        @for (t of tx.tags; track t) {
                          <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)]">
                            #{{ t }}
                          </span>
                        }
                      </div>
                    </div>
                  }
                </div>

                <!-- Split Allocations Breakdown if any -->
                @if (tx.allocations && tx.allocations.length > 0) {
                  <div class="p-3.5 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] space-y-2 text-xs">
                    <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)] block font-semibold">
                      Split Allocations ({{ tx.allocations.length }})
                    </span>
                    <div class="space-y-1.5">
                      @for (alloc of tx.allocations; track alloc.id) {
                        <div class="flex items-center justify-between p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                          <span class="font-medium text-[var(--color-ink)]">{{ getCategoryName(alloc.categoryId) }}</span>
                          <span class="font-mono font-bold tabular-nums text-[var(--color-ink)]">₹{{ formatMinor(alloc.amount) }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }

                <!-- System Metadata -->
                <div class="text-[11px] font-mono text-[var(--color-secondary)] flex flex-wrap gap-x-4 gap-y-1 pt-2">
                  <span>ID: {{ tx.id }}</span>
                  <span>Created: {{ tx.createdAt.split('T')[0] }}</span>
                  @if (tx.transferGroupId) {
                    <span>Transfer Group: {{ tx.transferGroupId }}</span>
                  }
                </div>
              </div>
            } @else {
              <!-- EDIT MODE FORM -->
              <form [formGroup]="editForm" class="space-y-4">
                <!-- Amount -->
                <div>
                  <label for="te-amount" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Amount <span class="text-red-500">*</span>
                  </label>
                  <div class="relative">
                    <span class="absolute left-3.5 top-1/2 -translate-y-1/2 font-editorial text-lg text-[var(--color-secondary)]">₹</span>
                    <input
                      id="te-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      formControlName="amountMajor"
                      class="w-full pl-8 pr-4 py-2 text-base font-editorial font-bold tabular-nums rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] focus:outline-hidden focus:border-[var(--color-accent)]"
                    />
                  </div>
                </div>

                <!-- Classification Type -->
                @if (tx.type !== 'INTERNAL_TRANSFER') {
                  <div>
                    <label for="te-type" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Classification <span class="text-red-500">*</span>
                    </label>
                    <select
                      id="te-type"
                      formControlName="type"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                    >
                      @for (entry of nonTransferTypeOptions; track entry.key) {
                        <option [value]="entry.key">{{ entry.label }} ({{ entry.cashImpact }})</option>
                      }
                    </select>
                  </div>
                }

                <!-- Date & Counterparty -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label for="te-date" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Date <span class="text-red-500">*</span>
                    </label>
                    <input
                      id="te-date"
                      type="date"
                      formControlName="transactionDate"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono"
                    />
                  </div>

                  @if (tx.type !== 'INTERNAL_TRANSFER') {
                    <div>
                      <label for="te-counterparty" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                        Counterparty
                      </label>
                      <select
                        id="te-counterparty"
                        formControlName="counterpartyId"
                        class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                      >
                        <option value="">None / Unassigned</option>
                        @for (cp of txState.activeCounterparties(); track cp.id) {
                          <option [value]="cp.id">{{ cp.name }}</option>
                        }
                      </select>
                    </div>
                  }
                </div>

                <!-- Category (if not transfer) -->
                @if (tx.type !== 'INTERNAL_TRANSFER') {
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <label for="te-category" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)]">Category</label>
                      <button
                        type="button"
                        (click)="toggleSplit()"
                        class="text-[11px] text-[var(--color-accent)] hover:underline flex items-center space-x-1 cursor-pointer"
                      >
                        <mat-icon class="text-[14px] w-3.5 h-3.5">{{ isSplit() ? 'check_box' : 'call_split' }}</mat-icon>
                        <span>{{ isSplit() ? 'Single Category' : 'Split Across Categories' }}</span>
                      </button>
                    </div>

                    @if (!isSplit()) {
                      <select
                        id="te-category"
                        formControlName="categoryId"
                        class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                      >
                        <option value="">No category assigned</option>
                        @for (cat of txState.activeCategories(); track cat.id) {
                          <option [value]="cat.id">{{ cat.parentId ? '— ' + cat.name : cat.name }}</option>
                        }
                      </select>
                    } @else {
                      <div class="p-3 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] space-y-2">
                        <div class="flex items-center justify-between text-xs">
                          <span class="font-mono text-[10px] uppercase text-[var(--color-secondary)]">Split Rows</span>
                          <span [class.text-emerald-700]="isSplitBalanced()" [class.text-amber-700]="!isSplitBalanced()" class="font-mono font-bold">
                            ₹{{ formatMajor(splitSum()) }} / ₹{{ formatMajor(editForm.get('amountMajor')?.value || 0) }}
                          </span>
                        </div>

                        @for (row of splitRows(); track $index) {
                          <div class="flex items-center space-x-2">
                            <select
                              [value]="row.categoryId"
                              (change)="updateSplitCategory($index, $any($event.target).value)"
                              class="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)]"
                            >
                              <option value="">Category...</option>
                              @for (cat of txState.activeCategories(); track cat.id) {
                                <option [value]="cat.id">{{ cat.name }}</option>
                              }
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="₹"
                              [value]="row.amountMajor"
                              (input)="updateSplitAmount($index, $any($event.target).value)"
                              class="w-24 px-2 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink)] font-mono"
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

                <!-- Description -->
                <div>
                  <label for="te-desc" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                    Description <span class="text-red-500">*</span>
                  </label>
                  <input
                    id="te-desc"
                    type="text"
                    formControlName="description"
                    class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                  />
                </div>

                <!-- Tags & Notes -->
                <div class="space-y-3">
                  <div>
                    <label for="te-tags" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Tags (Comma-separated)
                    </label>
                    <input
                      id="te-tags"
                      type="text"
                      formControlName="tagsInput"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                    />
                  </div>

                  <div>
                    <label for="te-notes" class="block text-xs font-mono uppercase tracking-wider text-[var(--color-secondary)] mb-1">
                      Notes
                    </label>
                    <textarea
                      id="te-notes"
                      rows="2"
                      formControlName="notes"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-ink)]"
                    ></textarea>
                  </div>
                </div>
              </form>
            }

            @if (localError()) {
              <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs">
                {{ localError() }}
              </div>
            }
          </div>

          <!-- Footer Actions -->
          <div class="px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-canvas)] flex flex-wrap items-center justify-between gap-3 shrink-0">
            @if (!isEditing()) {
              <div class="flex items-center space-x-2">
                @if (tx.status === 'POSTED') {
                  <button
                    type="button"
                    (click)="promptVoid(tx.id)"
                    class="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors cursor-pointer"
                  >
                    <mat-icon class="text-[16px] w-4 h-4">block</mat-icon>
                    <span>Void Transaction</span>
                  </button>
                }
              </div>

              <div class="flex items-center space-x-2">
                <button
                  type="button"
                  (click)="closed.emit()"
                  class="px-3.5 py-1.5 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                >
                  Close
                </button>
                @if (tx.status === 'POSTED') {
                  <button
                    type="button"
                    (click)="startEditing()"
                    class="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-canvas)] text-[var(--color-ink)] transition-colors cursor-pointer"
                  >
                    <mat-icon class="text-[16px] w-4 h-4">edit</mat-icon>
                    <span>Edit</span>
                  </button>
                }
              </div>
            } @else {
              <button
                type="button"
                (click)="cancelEditing()"
                class="px-3.5 py-1.5 rounded-xl text-xs text-[var(--color-secondary)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              >
                Cancel Edit
              </button>

              <button
                type="button"
                [disabled]="isEditInvalid() || txState.actionLoading()"
                (click)="saveEdit()"
                class="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors cursor-pointer"
              >
                @if (txState.actionLoading()) {
                  <mat-icon class="animate-spin text-[16px] w-4 h-4">sync</mat-icon>
                  <span>Saving...</span>
                } @else {
                  <mat-icon class="text-[16px] w-4 h-4">check</mat-icon>
                  <span>Save Changes</span>
                }
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class TransactionEditModal implements OnInit {
  readonly transaction = input<Transaction | null>(null);
  readonly closed = output<void>();

  readonly txState = inject(TransactionState);
  readonly accountState = inject(AccountState);

  readonly isEditing = signal<boolean>(false);
  readonly isSplit = signal<boolean>(false);
  readonly localError = signal<string | null>(null);
  readonly splitRows = signal<SplitRow[]>([]);

  readonly nonTransferTypeOptions = (Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[])
    .filter((k) => k !== 'INTERNAL_TRANSFER')
    .map((key) => ({
      key,
      ...TRANSACTION_TYPE_LABELS[key],
    }));

  readonly editForm = new FormGroup({
    amountMajor: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    type: new FormControl<TransactionType>('EXPENSE', [Validators.required]),
    categoryId: new FormControl<string>(''),
    counterpartyId: new FormControl<string>(''),
    transactionDate: new FormControl<string>('', [Validators.required]),
    description: new FormControl<string>('', [Validators.required]),
    tagsInput: new FormControl<string>(''),
    notes: new FormControl<string>(''),
  });

  get typeMeta() {
    const tx = this.transaction();
    if (!tx) return TRANSACTION_TYPE_LABELS.EXPENSE;
    return TRANSACTION_TYPE_LABELS[tx.type] || TRANSACTION_TYPE_LABELS.EXPENSE;
  }

  readonly splitSum = computed(() => {
    return this.splitRows().reduce((acc, r) => acc + (r.amountMajor || 0), 0);
  });

  readonly isSplitBalanced = computed(() => {
    const total = this.editForm.get('amountMajor')?.value || 0;
    return Math.abs(this.splitSum() - total) < 0.001;
  });

  ngOnInit(): void {
    const tx = this.transaction();
    if (tx) {
      this.populateForm(tx);
    }
  }

  private populateForm(tx: Transaction): void {
    const major = toMajorUnits(tx.amount);
    this.editForm.patchValue({
      amountMajor: major,
      type: tx.type,
      categoryId: tx.categoryId || '',
      counterpartyId: tx.counterpartyId || '',
      transactionDate: tx.transactionDate,
      description: tx.description,
      tagsInput: tx.tags ? tx.tags.join(', ') : '',
      notes: tx.notes || '',
    });

    if (tx.allocations && tx.allocations.length > 0) {
      this.isSplit.set(true);
      this.splitRows.set(
        tx.allocations.map((a) => ({
          categoryId: a.categoryId,
          amountMajor: toMajorUnits(a.amount),
          notes: a.notes || '',
        }))
      );
    } else {
      this.isSplit.set(false);
      this.splitRows.set([]);
    }
  }

  startEditing(): void {
    const tx = this.transaction();
    if (tx) {
      this.populateForm(tx);
      this.isEditing.set(true);
    }
  }

  cancelEditing(): void {
    this.isEditing.set(false);
    this.localError.set(null);
  }

  isEditInvalid(): boolean {
    if (this.editForm.invalid) return true;
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
      const total = this.editForm.get('amountMajor')?.value || 0;
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

  formatMinor(minor: number): string {
    return formatMinorUnits(minor);
  }

  formatMajor(num: number): string {
    return (num || 0).toFixed(2);
  }

  getAccountName(accId: string | null | undefined): string {
    if (!accId) return '—';
    const acc = this.accountState.accounts().find((a) => a.id === accId);
    return acc ? acc.name : accId;
  }

  getCategoryName(catId: string | null | undefined): string {
    if (!catId) return 'Uncategorized';
    const cat = this.txState.categories().find((c) => c.id === catId);
    return cat ? cat.name : catId;
  }

  getCounterpartyName(cpId: string | null | undefined): string {
    if (!cpId) return '—';
    const cp = this.txState.counterparties().find((c) => c.id === cpId);
    return cp ? cp.name : cpId;
  }

  async saveEdit(): Promise<void> {
    const tx = this.transaction();
    if (!tx) return;

    this.localError.set(null);
    const v = this.editForm.value;

    const minorUnits = toMinorUnits(v.amountMajor!);
    const tags = (v.tagsInput || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    let allocations: { categoryId: string; amount: number; tags?: string[]; notes?: string }[] | undefined;
    if (this.isSplit()) {
      allocations = this.splitRows().map((r) => ({
        categoryId: r.categoryId,
        amount: toMinorUnits(r.amountMajor || 0),
        notes: r.notes || '',
      }));
    }

    try {
      await this.txState.updateTransaction(tx.id, {
        amount: minorUnits,
        type: tx.type === 'INTERNAL_TRANSFER' ? tx.type : v.type!,
        transactionDate: v.transactionDate!,
        description: v.description!,
        categoryId: this.isSplit() ? null : v.categoryId || null,
        counterpartyId: v.counterpartyId || null,
        tags,
        notes: v.notes || '',
        allocations: this.isSplit() ? allocations : [],
      });
      this.isEditing.set(false);
      this.closed.emit();
    } catch (err: unknown) {
      this.localError.set(err instanceof Error ? err.message : 'Failed to update transaction');
    }
  }

  async promptVoid(txId: string): Promise<void> {
    const reason = window.prompt('Provide a reason for voiding this transaction (optional):');
    if (reason !== null) {
      try {
        await this.txState.voidTransaction(txId, reason);
        this.closed.emit();
      } catch (err: unknown) {
        this.localError.set(err instanceof Error ? err.message : 'Failed to void transaction');
      }
    }
  }
}
