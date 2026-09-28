import { Injectable, signal, computed, inject } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import {
  Account,
  BalanceSnapshot,
  CreateAccountPayload,
  UpdateAccountPayload,
  ReconcilePayload,
  ReconcileResult,
} from './account-models';

@Injectable({
  providedIn: 'root',
})
export class AccountState {
  private readonly api = inject(ApiClientService);

  readonly accounts = signal<Account[]>([]);
  readonly selectedAccountId = signal<string | null>(null);
  readonly balanceHistory = signal<BalanceSnapshot[]>([]);

  readonly loading = signal<boolean>(false);
  readonly historyLoading = signal<boolean>(false);
  readonly actionLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Derived state
  readonly selectedAccount = computed(() => {
    const id = this.selectedAccountId();
    if (!id) return null;
    return this.accounts().find((a) => a.id === id) ?? null;
  });

  readonly cashAccount = computed(() => {
    return this.accounts().find((a) => a.type === 'cash') ?? null;
  });

  readonly hasCashAccount = computed(() => {
    return !!this.cashAccount();
  });

  readonly bankAccounts = computed(() => {
    return this.accounts().filter((a) => a.type === 'bank');
  });

  readonly totalCalculatedBalance = computed(() => {
    return this.accounts()
      .filter((a) => a.isActive)
      .reduce((sum, a) => sum + a.calculatedBalance, 0);
  });

  readonly activeAccountsCount = computed(() => {
    return this.accounts().filter((a) => a.isActive).length;
  });

  /**
   * Loads all user accounts from the secure Node.js API.
   */
  async loadAccounts(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.api.get<Account[]>('/api/accounts');
      this.accounts.set(data);

      // Auto-select first account if none selected
      if (!this.selectedAccountId() && data.length > 0) {
        this.selectAccount(data[0].id);
      } else if (this.selectedAccountId()) {
        const stillExists = data.some((a) => a.id === this.selectedAccountId());
        if (!stillExists) {
          this.selectAccount(data.length > 0 ? data[0].id : null);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load accounts';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Selects an account and fetches its historical balance snapshots.
   */
  selectAccount(accountId: string | null): void {
    this.selectedAccountId.set(accountId);
    if (accountId) {
      this.loadBalanceHistory(accountId);
    } else {
      this.balanceHistory.set([]);
    }
  }

  /**
   * Fetches reported balance snapshots for the selected account.
   */
  async loadBalanceHistory(accountId: string): Promise<void> {
    this.historyLoading.set(true);
    try {
      const history = await this.api.get<BalanceSnapshot[]>(`/api/accounts/${accountId}/balance-history`);
      this.balanceHistory.set(history);
    } catch {
      this.balanceHistory.set([]);
    } finally {
      this.historyLoading.set(false);
    }
  }

  /**
   * Creates a new account via the trusted API.
   */
  async createAccount(payload: CreateAccountPayload): Promise<Account> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const newAccount = await this.api.post<Account>('/api/accounts', payload);
      this.accounts.update((prev) => [newAccount, ...prev]);
      this.selectAccount(newAccount.id);
      return newAccount;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Account creation failed';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Updates existing account metadata, opening balance, or status.
   */
  async updateAccount(accountId: string, payload: UpdateAccountPayload): Promise<Account> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.put<Account>(`/api/accounts/${accountId}`, payload);
      this.accounts.update((prev) =>
        prev.map((a) => (a.id === accountId ? updated : a))
      );
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Account update failed';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Performs balance snapshot capture and reconciliation workflow.
   */
  async reconcile(accountId: string, payload: ReconcilePayload): Promise<ReconcileResult> {
    this.actionLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.api.post<ReconcileResult>(`/api/accounts/${accountId}/reconcile`, payload);
      
      // Update account in state
      this.accounts.update((prev) =>
        prev.map((a) => (a.id === accountId ? result.account : a))
      );

      // Prepend snapshot to balance history
      this.balanceHistory.update((prev) => [result.snapshot, ...prev]);

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reconciliation failed';
      this.error.set(msg);
      throw err;
    } finally {
      this.actionLoading.set(false);
    }
  }
}
