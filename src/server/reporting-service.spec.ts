import { describe, it, expect, beforeEach } from 'vitest';
import { setFirebaseAdminForTesting } from './firebase-admin.js';
import {
  resolveReportingPeriod,
  formatPrettyDate,
  validateISODate,
  isValidPeriodType,
  getDashboardReport,
} from './reporting-service.js';
import type { AccountDocument } from './account-service.js';
import type { TransactionDocument } from './transaction-service.js';
import type { CategoryDocument } from './metadata-service.js';

describe('Reporting Service & Period Semantics', () => {
  describe('formatPrettyDate and validateISODate', () => {
    it('formats ISO dates into MMM D, YYYY without timezone shift', () => {
      expect(formatPrettyDate('2026-04-01')).toBe('Apr 1, 2026');
      expect(formatPrettyDate('2027-03-31')).toBe('Mar 31, 2027');
      expect(formatPrettyDate('2026-10-15')).toBe('Oct 15, 2026');
      expect(formatPrettyDate('2026-01-05')).toBe('Jan 5, 2026');
    });

    it('validates ISO dates correctly', () => {
      expect(validateISODate('2026-04-01')).toBe(true);
      expect(validateISODate('2026-02-28')).toBe(true);
      expect(validateISODate('2026-02-30')).toBe(false); // Invalid Feb date
      expect(validateISODate('not-a-date')).toBe(false);
      expect(validateISODate('2026-13-01')).toBe(false);
      expect(validateISODate('')).toBe(false);
    });

    it('validates period types correctly', () => {
      expect(isValidPeriodType('current_month')).toBe(true);
      expect(isValidPeriodType('financial_year')).toBe(true);
      expect(isValidPeriodType('last_12_months')).toBe(true);
      expect(isValidPeriodType('all_history')).toBe(true);
      expect(isValidPeriodType('custom')).toBe(true);
      expect(isValidPeriodType('quarter')).toBe(false); // Quarter is forbidden
      expect(isValidPeriodType('random_period')).toBe(false);
    });
  });

  describe('resolveReportingPeriod and Validation', () => {
    it('resolves Current Month correctly', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('current_month', undefined, undefined, refDate);
      expect(range.period).toBe('current_month');
      expect(range.startDate).toBe('2026-10-01');
      expect(range.endDate).toBe('2026-10-31');
      expect(range.label).toBe('Current Month · Oct 1, 2026 – Oct 31, 2026');
    });

    it('resolves Financial Year (Apr 1 - Mar 31) for a date in October 2026', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('financial_year', undefined, undefined, refDate, 4);
      expect(range.period).toBe('financial_year');
      expect(range.startDate).toBe('2026-04-01');
      expect(range.endDate).toBe('2027-03-31');
      expect(range.label).toBe('Financial Year · Apr 1, 2026 – Mar 31, 2027');
    });

    it('resolves Financial Year (Apr 1 - Mar 31) for a date in February 2027', () => {
      const refDate = new Date(2027, 1, 10); // Feb 10, 2027
      const range = resolveReportingPeriod('financial_year', undefined, undefined, refDate, 4);
      expect(range.period).toBe('financial_year');
      expect(range.startDate).toBe('2026-04-01');
      expect(range.endDate).toBe('2027-03-31');
      expect(range.label).toBe('Financial Year · Apr 1, 2026 – Mar 31, 2027');
    });

    it('rejects invalid financial year start months', () => {
      expect(() => resolveReportingPeriod('financial_year', undefined, undefined, new Date(), 0)).toThrow(
        /Invalid financialYearStartMonth/,
      );
      expect(() => resolveReportingPeriod('financial_year', undefined, undefined, new Date(), 13)).toThrow(
        /Invalid financialYearStartMonth/,
      );
    });

    it('resolves Last 12 Months correctly', () => {
      const refDate = new Date(2026, 9, 15); // Oct 15, 2026
      const range = resolveReportingPeriod('last_12_months', undefined, undefined, refDate);
      expect(range.period).toBe('last_12_months');
      expect(range.startDate).toBe('2025-11-01');
      expect(range.endDate).toBe('2026-10-31');
      expect(range.label).toBe('Last 12 Months · Nov 1, 2025 – Oct 31, 2026');
    });

    it('resolves All History correctly', () => {
      const range = resolveReportingPeriod('all_history');
      expect(range.period).toBe('all_history');
      expect(range.startDate).toBe('1970-01-01');
      expect(range.endDate).toBe('9999-12-31');
      expect(range.label).toBe('All History · Lifetime Activity');
    });

    it('validates custom range parameters strictly', () => {
      // Missing dates
      expect(() => resolveReportingPeriod('custom')).toThrow(/startDate and endDate are required/);
      expect(() => resolveReportingPeriod('custom', '2026-01-01')).toThrow(/startDate and endDate are required/);

      // Malformed dates
      expect(() => resolveReportingPeriod('custom', 'invalid-date', '2026-05-01')).toThrow(/Invalid custom startDate/);
      expect(() => resolveReportingPeriod('custom', '2026-01-01', 'bad-end-date')).toThrow(/Invalid custom endDate/);

      // Start date after end date
      expect(() => resolveReportingPeriod('custom', '2026-10-01', '2026-05-01')).toThrow(/cannot be after endDate/);

      // Valid range
      const range = resolveReportingPeriod('custom', '2026-06-01', '2026-08-31');
      expect(range.period).toBe('custom');
      expect(range.startDate).toBe('2026-06-01');
      expect(range.endDate).toBe('2026-08-31');
      expect(range.label).toBe('Custom Range · Jun 1, 2026 – Aug 31, 2026');
    });
  });

  describe('getDashboardReport with canonical mock data', () => {
    const userId = 'user-dashboard-1';

    let accountsStore: Map<string, AccountDocument>;
    let categoriesStore: Map<string, CategoryDocument>;
    let transactionsStore: Map<string, TransactionDocument>;

    interface MockFilter {
      field: string;
      op: string;
      val: unknown;
    }
    interface MockOrder {
      field: string;
      dir: 'asc' | 'desc';
    }

    const createQueryBuilder = (filters: MockFilter[] = [], orders: MockOrder[] = [], limitVal?: number) => {
      const builder = {
        where: (field: string, op: string, val: unknown) => {
          return createQueryBuilder([...filters, { field, op, val }], orders, limitVal);
        },
        orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
          return createQueryBuilder(filters, [...orders, { field, dir }], limitVal);
        },
        limit: (n: number) => {
          return createQueryBuilder(filters, orders, n);
        },
        get: async () => {
          let docs = Array.from(transactionsStore.values()).filter((t) => t.userId === userId);

          for (const f of filters) {
            docs = docs.filter((t) => {
              const val = (t as unknown as Record<string, unknown>)[f.field];
              if (f.op === '==') return val === f.val;
              if (f.op === '>=') return (val as string) >= (f.val as string);
              if (f.op === '<=') return (val as string) <= (f.val as string);
              if (f.op === '>') return (val as string) > (f.val as string);
              if (f.op === '<') return (val as string) < (f.val as string);
              return true;
            });
          }

          if (orders.length > 0) {
            docs.sort((a, b) => {
              for (const o of orders) {
                const aVal = String((a as unknown as Record<string, unknown>)[o.field] || '');
                const bVal = String((b as unknown as Record<string, unknown>)[o.field] || '');
                const cmp = o.dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                if (cmp !== 0) return cmp;
              }
              return 0;
            });
          }

          if (limitVal !== undefined) {
            docs = docs.slice(0, limitVal);
          }

          return {
            empty: docs.length === 0,
            docs: docs.map((d) => ({ id: d.id, data: () => d })),
          };
        },
      };
      return builder;
    };

    beforeEach(() => {
      accountsStore = new Map();
      categoriesStore = new Map();
      transactionsStore = new Map();

      const mockDb = {
        collection: (colName: string) => {
          if (colName !== 'users') throw new Error(`Unexpected collection ${colName}`);
          return {
            doc: (docUserId: string) => {
              return {
                collection: (subCol: string) => {
                  if (subCol === 'accounts') {
                    return {
                      get: async () => {
                        const docs = Array.from(accountsStore.values())
                          .filter((a) => a.userId === docUserId)
                          .map((a) => ({ id: a.id, data: () => a }));
                        return { empty: docs.length === 0, docs };
                      },
                    };
                  }
                  if (subCol === 'categories') {
                    return {
                      get: async () => {
                        const docs = Array.from(categoriesStore.values())
                          .filter((c) => c.userId === docUserId)
                          .map((c) => ({ id: c.id, data: () => c }));
                        return { empty: docs.length === 0, docs };
                      },
                    };
                  }
                  if (subCol === 'transactions') {
                    return createQueryBuilder();
                  }
                  return {
                    get: async () => ({ empty: true, docs: [] }),
                  };
                },
              };
            },
          };
        },
      };

      setFirebaseAdminForTesting({
        db: mockDb as unknown as FirebaseFirestore.Firestore,
        auth: null,
        app: null,
        initialized: true,
      });
    });

    it('computes empty financial state without errors', async () => {
      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date(2026, 9, 1),
      });

      expect(report.netWorth.cashPosition).toBe(0);
      expect(report.netWorth.totalNetWorth).toBe(0);
      expect(report.netWorth.disclaimer).toContain('Based on available financial');
      expect(report.periodMetrics.grossIncome).toBe(0);
      expect(report.periodMetrics.totalExpenses).toBe(0);
      expect(report.periodMetrics.savings).toBe(0);
      expect(report.periodMetrics.savingsRate).toBeNull();
      expect(report.cashFlow.internalTransferNetImpact).toBe(0);
      expect(report.composition.accounts).toHaveLength(0);
      expect(report.syncStatus.totalActiveAccounts).toBe(0);
      expect(report.syncStatus.isFullyReconciled).toBe(false);
    });

    it('truthfully reconstructs historical account balances as of period end date', async () => {
      // Account opened Jan 1, 2026 with opening balance ₹1,00,000 (10,000,000 paise)
      // Transaction in Jan: +₹50,000
      // Transaction in Mar: -₹20,000
      // Transaction in Oct: +₹1,00,000
      // Current calculatedBalance = 1,00,000 + 50,000 - 20,000 + 1,00,000 = ₹2,30,000 (23,000,000 paise)
      accountsStore.set('acc-1', {
        id: 'acc-1',
        userId,
        name: 'HDFC Savings',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 10000000,
        openingBalanceDate: '2026-01-01',
        calculatedBalance: 23000000, // Today's balance
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
      });

      // Transactions
      transactionsStore.set('tx-jan', {
        id: 'tx-jan',
        userId,
        accountId: 'acc-1',
        amount: 5000000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-01-15',
        description: 'Jan Bonus',
        allocations: [],
        createdAt: '2026-01-15T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
      });

      transactionsStore.set('tx-mar', {
        id: 'tx-mar',
        userId,
        accountId: 'acc-1',
        amount: 2000000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-03-10',
        description: 'Mar Equipment',
        allocations: [],
        createdAt: '2026-03-10T00:00:00Z',
        updatedAt: '2026-03-10T00:00:00Z',
      });

      transactionsStore.set('tx-oct', {
        id: 'tx-oct',
        userId,
        accountId: 'acc-1',
        amount: 10000000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        description: 'Oct Client Payment',
        allocations: [],
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      });

      // Request a historical report for April 2026 (when today is Oct 15, 2026)
      const report = await getDashboardReport(userId, {
        period: 'custom',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        referenceDate: new Date('2026-10-15T12:00:00Z'),
      });

      // Historical reconstruction checks:
      expect(report.netWorth.isHistoricalReconstruction).toBe(true);
      expect(report.netWorth.asOfDate).toBe('2026-04-30');
      expect(report.netWorth.currentCashPosition).toBe(23000000); // Current today is ₹2,30,000

      // Reconstructed position as of April 30, 2026 must be:
      // Current (23,000,000) - Oct transaction (10,000,000) = 13,000,000 paise (₹1,30,000)
      expect(report.netWorth.cashPosition).toBe(13000000);
      expect(report.netWorth.totalNetWorth).toBe(13000000);
      expect(report.composition.accounts[0].asOfBalance).toBe(13000000);
      expect(report.composition.accounts[0].calculatedBalance).toBe(23000000);
      expect(report.netWorth.disclaimer).toContain('Reconstructed financial position as of Apr 30, 2026');
    });

    it('truthfully derives debt liabilities and debt ratio from borrowing and repayment transactions', async () => {
      accountsStore.set('acc-1', {
        id: 'acc-1',
        userId,
        name: 'HDFC Savings',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 10000000, // ₹1,00,000
        calculatedBalance: 10000000,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // 1. Debt borrowing: ₹50,000 (5,000,000 paise)
      transactionsStore.set('tx-borrow', {
        id: 'tx-borrow',
        userId,
        accountId: 'acc-1',
        amount: 5000000,
        type: 'DEBT_BORROWING',
        status: 'POSTED',
        transactionDate: '2026-10-02',
        description: 'Personal Loan Credit',
        allocations: [],
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      });

      // 2. Debt repayment: ₹10,000 (1,000,000 paise)
      transactionsStore.set('tx-repay', {
        id: 'tx-repay',
        userId,
        accountId: 'acc-1',
        amount: 1000000,
        type: 'DEBT_REPAYMENT',
        status: 'POSTED',
        transactionDate: '2026-10-10',
        description: 'Loan Principal EMI',
        allocations: [],
        createdAt: '2026-10-10T00:00:00Z',
        updatedAt: '2026-10-10T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date('2026-10-15T12:00:00Z'),
      });

      // Outstanding Debt = 50,000 - 10,000 = ₹40,000 (4,000,000 paise)
      expect(report.netWorth.liabilities).toBe(4000000);
      expect(report.netWorth.cashPosition).toBe(10000000);
      // Net Worth = Cash (10,000,000) - Liabilities (4,000,000) = 6,000,000 paise (₹60,000)
      expect(report.netWorth.totalNetWorth).toBe(6000000);

      // Debt ratio = 4,000,000 / 10,000,000 = 40.0%
      expect(report.financialHealth.debtRatio.value).toBe(40.0);
      expect(report.financialHealth.debtRatio.formatted).toBe('40%');
      expect(report.financialHealth.debtRatio.description).toContain('Cumulative debt borrowings minus repayments');
    });

    it('calculates Cash Runway strictly using consumption expenses, excluding asset purchases', async () => {
      accountsStore.set('acc-1', {
        id: 'acc-1',
        userId,
        name: 'HDFC Savings',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 6000000, // ₹60,000
        calculatedBalance: 6000000,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // Consumption expense: ₹15,000 (1,500,000 paise)
      transactionsStore.set('tx-exp', {
        id: 'tx-exp',
        userId,
        accountId: 'acc-1',
        amount: 1500000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        description: 'Groceries',
        allocations: [],
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      });

      // Non-financial asset purchase: ₹35,000 (3,500,000 paise)
      transactionsStore.set('tx-asset', {
        id: 'tx-asset',
        userId,
        accountId: 'acc-1',
        amount: 3500000,
        type: 'NON_FINANCIAL_ASSET_PURCHASE',
        status: 'POSTED',
        transactionDate: '2026-10-08',
        description: 'Gold coin / furniture',
        allocations: [],
        createdAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date('2026-10-15T12:00:00Z'),
      });

      // Total Expenses = 15,000 + 35,000 = ₹50,000
      expect(report.periodMetrics.totalExpenses).toBe(5000000);
      expect(report.periodMetrics.consumptionExpenses).toBe(1500000);

      // Runway denominator MUST BE consumption expenses (₹15,000/month), NOT total expenses (₹50,000)!
      // Runway = Cash Position (₹60,000) / ₹15,000/month = 4.0 months!
      expect(report.financialHealth.cashRunwayMonths.value).toBe(4.0);
      expect(report.financialHealth.cashRunwayMonths.formatted).toBe('4 months');
      expect(report.financialHealth.cashRunwayMonths.formula).toContain('Average Monthly Consumption Expenses');
    });

    it('correctly deducts taxes in monthly trends savings', async () => {
      // Oct 2026 transactions:
      // Income: ₹1,00,000
      // Tax: ₹20,000
      // Expenses: ₹30,000
      transactionsStore.set('tx-inc', {
        id: 'tx-inc',
        userId,
        accountId: 'acc-1',
        amount: 10000000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-10-01',
        description: 'Salary',
        allocations: [],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      transactionsStore.set('tx-tax', {
        id: 'tx-tax',
        userId,
        accountId: 'acc-1',
        amount: 2000000,
        type: 'TAX',
        status: 'POSTED',
        transactionDate: '2026-10-02',
        description: 'Advance Tax',
        allocations: [],
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      });
      transactionsStore.set('tx-exp', {
        id: 'tx-exp',
        userId,
        accountId: 'acc-1',
        amount: 3000000,
        type: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        description: 'Household',
        allocations: [],
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date('2026-10-15T12:00:00Z'),
      });

      expect(report.monthlyTrends).toHaveLength(1);
      const oct = report.monthlyTrends[0];
      expect(oct.grossIncome).toBe(10000000);
      expect(oct.netTaxPaid).toBe(2000000);
      expect(oct.netIncome).toBe(8000000); // 1,00,000 - 20,000 = ₹80,000
      expect(oct.expenses).toBe(3000000);
      // Net Savings = Net Income (80,000) - Expenses (30,000) = ₹50,000 (5,000,000 paise)
      expect(oct.savings).toBe(5000000);
    });

    it('reports real account sync status based on reconciliation records', async () => {
      // Account 1: Fully reconciled (reportedBalance === calculatedBalance && lastReconciledAt set)
      accountsStore.set('acc-1', {
        id: 'acc-1',
        userId,
        name: 'HDFC Savings',
        type: 'bank',
        institution: 'HDFC Bank',
        currency: 'INR',
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01',
        calculatedBalance: 500000,
        reportedBalance: 500000,
        lastReconciledAt: '2026-10-10T10:00:00Z',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-10-10T10:00:00Z',
      });

      // Account 2: Unreconciled
      accountsStore.set('acc-2', {
        id: 'acc-2',
        userId,
        name: 'ICICI Current',
        type: 'bank',
        institution: 'ICICI Bank',
        currency: 'INR',
        openingBalance: 200000,
        openingBalanceDate: '2026-01-01',
        calculatedBalance: 400000,
        reportedBalance: null,
        lastReconciledAt: null,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const report = await getDashboardReport(userId, {
        period: 'current_month',
        referenceDate: new Date('2026-10-15T12:00:00Z'),
      });

      expect(report.syncStatus.totalActiveAccounts).toBe(2);
      expect(report.syncStatus.reconciledAccountsCount).toBe(1);
      expect(report.syncStatus.unreconciledAccountsCount).toBe(1);
      expect(report.syncStatus.isFullyReconciled).toBe(false);
      expect(report.syncStatus.statusLabel).toBe('1 of 2 accounts reconciled');
    });
  });
});
