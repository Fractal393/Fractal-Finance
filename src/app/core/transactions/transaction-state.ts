import { Injectable, signal, computed, inject } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { AccountState } from '../accounts/account-state';
import {
  Transaction,
  Category,
  Counterparty,
  Tag,
  CreateTransactionPayload,
  CreateTransferPayload,
  UpdateTransactionPayload,
  PaginatedTransactionsResult,
  TransactionFilterQuery,
} from './transaction-models';

@Injectable({
  providedIn: 'root',
})
export class TransactionState {
  private readonly api = inject(ApiClientService);
  private readonly accountState = inject(AccountState);

  readonly transactions = signal<Transaction[]>([]);
  readonly selectedTransactionId = signal<string | null>(null);

  readonly categories = signal<Category[]>([]);
  readonly counterparties = signal<Counterparty[]>([]);
  readonly tags = signal<Tag[]>([]);

  readonly filters = signal<TransactionFilterQuery>({
    status: 'POSTED',
    limit: 25,
  });

  readonly loading = signal<boolean>(false);
  readonly metadataLoading = signal<boolean>(false);
  readonly actionLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly nextCursor = signal<string | null>(null);
  readonly hasMore = signal<boolean>(false);

  // Derived state
  readonly selectedTransaction = computed(() => {
    const id = this.selectedTransactionId();
    if (!id) return null;
    return this.transactions().find((t) => t.id === id) ?? null;
  });

  readonly activeCategories = computed(() => {
    return this.categories().filter((c) => c.isActive);
  });

  readonly activeCounterparties = computed(() => {
    return this.counterparties().filter((c) => c.isActive);
  });

  readonly activeTags = computed(() => {
    return this.tags().filter((t) => t.isActive);
  });

  /**
   * Loads categories, counterparties, and tags from the trusted API.
   */
  async loadMetadata(): Promise<void> {
    this.metadataLoading.set(true);
    try {
      const [cats, cps, tgs] = await Promise.all([
        this.api.get<Category[]>('/api/categories'),
        this.api.get<Counterparty[]>('/api/counterparties'),
        this.api.get<Tag[]>('/api/tags'),
      ]);
      this.categories.set(cats);
      this.counterparties.set(cps);
      this.tags.set(tgs);
    } catch {
      // Non-fatal
    } finally {
      this.metadataLoading.set(false);
    }
  }

  /**
   * Fetches paginated transactions according to current filters.
   */
  async loadTransactions(reset = true): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const f = this.filters();
    const queryParams: Record<string, string> = {};

    if (f.accountId) queryParams['accountId'] = f.accountId;
    if (f.type) queryParams['type'] = f.type;
    if (f.categoryId) queryParams['categoryId'] = f.categoryId;
    if (f.counterpartyId) queryParams['counterpartyId'] = f.counterpartyId;
    if (f.tag) queryParams['tag'] = f.tag;
    if (f.status) queryParams['status'] = f.status;
    if (f.startDate) queryParams['startDate'] = f.startDate;
    if (f.endDate) queryParams['endDate'] = f.endDate;
    if (f.search) queryParams['search'] = f.search;
    if (f.limit) queryParams['limit'] = f.limit.toString();
    if (!reset && this.nextCursor()) {
      queryParams['cursor'] = this.nextCursor()!;
    }

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `/api/transactions${queryString ? `?${queryString}` : ''}`;

    try {
      const res = await this.api.get<PaginatedTransactionsResult>(url);
      if (reset) {
        this.transactions.set(res.items);
      } else {
        this.transactions.update((prev) => [...prev, ...res.items]);
      }
      this.nextCursor.set(res.nextCursor);
      this.hasMore.set(res.hasMore);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load transactions';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  setFilter<K extends keyof TransactionFilterQuery>(key: K, value: TransactionFilterQuery[K]): void {
    this.filters.update((prev) => ({ ...prev, [key]: value }));
    this.loadTransactions(true);
  }

  resetFilters(): void {
    this.filters.set({
      status: 'POSTED',
      limit: 25,
    });
    this.loadTransactions(true);
  }

  selectTransaction(id: string | null): void {
    this.selectedTransactionId.set(id);
  }

  /**
   * Creates a transaction, updates local state and syncs account balances.
   */
  async createTransaction(payload: CreateTransactionPayload): Promise<Transaction> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const tx = await this.api.post<Transaction>('/api/transactions', payload);
      this.transactions.update((prev) => [tx, ...prev]);
      // Sync account balance in background
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Account sync skipped:', err);
      });
      return tx;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction creation failed';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Creates an internal transfer pairing, updating both accounts.
   */
  async createTransfer(payload: CreateTransferPayload): Promise<{ sourceTransaction: Transaction; destinationTransaction: Transaction }> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.post<{ sourceTransaction: Transaction; destinationTransaction: Transaction }>(
        '/api/transactions/transfer',
        payload
      );
      this.transactions.update((prev) => [res.sourceTransaction, res.destinationTransaction, ...prev]);
      // Sync account balances
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Account sync skipped:', err);
      });
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transfer creation failed';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Edits an existing transaction.
   */
  async updateTransaction(id: string, payload: UpdateTransactionPayload): Promise<Transaction> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.put<Transaction>(`/api/transactions/${id}`, payload);
      this.transactions.update((prev) => prev.map((t) => (t.id === id ? updated : t)));
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Account sync skipped:', err);
      });
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update transaction';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Safely voids a transaction without deleting records.
   */
  async voidTransaction(id: string, reason?: string): Promise<Transaction> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const voided = await this.api.post<Transaction>(`/api/transactions/${id}/void`, { reason });
      this.transactions.update((prev) => {
        // If transfer, void both linked records
        if (voided.transferGroupId) {
          return prev.map((t) =>
            t.transferGroupId === voided.transferGroupId ? { ...t, status: 'VOIDED' as const } : t
          );
        }
        return prev.map((t) => (t.id === id ? voided : t));
      });
      this.accountState.loadAccounts().catch((err: unknown) => {
        console.warn('Account sync skipped:', err);
      });
      return voided;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void transaction';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  // Quick metadata creators
  async addCategory(name: string, parentId?: string | null, type?: string): Promise<Category> {
    const cat = await this.api.post<Category>('/api/categories', { name, parentId, type });
    this.categories.update((prev) => [...prev, cat]);
    return cat;
  }

  async addCounterparty(name: string, notes?: string): Promise<Counterparty> {
    const cp = await this.api.post<Counterparty>('/api/counterparties', { name, notes });
    this.counterparties.update((prev) => {
      if (prev.some((p) => p.id === cp.id)) return prev;
      return [...prev, cp];
    });
    return cp;
  }

  async addTag(name: string, color?: string): Promise<Tag> {
    const tag = await this.api.post<Tag>('/api/tags', { name, color });
    this.tags.update((prev) => {
      if (prev.some((t) => t.id === tag.id)) return prev;
      return [...prev, tag];
    });
    return tag;
  }
}
