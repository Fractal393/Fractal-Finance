const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPrettyDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const monthName = MONTH_NAMES[monthIdx] || parts[1];
  return `${monthName} ${day}, ${year}`;
}

export type ReportingPeriodType =
  | 'current_month'
  | 'financial_year'
  | 'last_12_months'
  | 'all_history'
  | 'custom';

export interface ReportingDateRange {
  period: ReportingPeriodType;
  startDate: string;
  endDate: string;
  label: string;
}

export interface AccountSyncStatus {
  totalActiveAccounts: number;
  reconciledAccountsCount: number;
  unreconciledAccountsCount: number;
  lastReconciledAt: string | null;
  isFullyReconciled: boolean;
  statusLabel: string;
  details: string;
}

export interface DashboardReport {
  period: ReportingDateRange;
  generatedAt: string;

  // Real account reconciliation & sync status
  syncStatus: AccountSyncStatus;

  // 1. Net Worth Hero & Cash Position
  netWorth: {
    totalNetWorth: number;
    cashPosition: number; // Reconstructed as of asOfDate
    currentCashPosition: number; // Balance today
    asOfDate: string;
    isHistoricalReconstruction: boolean;
    financialAssets: number;
    nonFinancialAssets: number;
    liabilities: number; // Truthfully calculated from DEBT_BORROWING - DEBT_REPAYMENT
    isFullyDerived: boolean;
    disclaimer: string;
    unavailableComponents: string[];
  };

  // 2. Selected Period Financial Metrics
  periodMetrics: {
    grossIncome: number;
    netTaxPaid: number;
    otherIncomeDeductions: number;
    netIncome: number;
    consumptionExpenses: number;
    nonFinancialAssetPurchases: number;
    totalExpenses: number;
    savings: number;
    savingsRate: number | null;
    investmentAllocation: number;
    cashRetained: number;
  };

  // 3. Cash Flow Details
  cashFlow: {
    totalInflows: number;
    totalOutflows: number;
    netMovement: number;
    internalTransferVolume: number;
    internalTransferNetImpact: 0;
    breakdown: {
      incomeInflow: number;
      receivableRepayments: number;
      borrowings: number;
      consumptionOutflow: number;
      assetPurchasesOutflow: number;
      taxOutflow: number;
      investmentOutflow: number;
      moneyLentOutflow: number;
      debtRepaymentOutflow: number;
      reconciliationAdjustments: number;
    };
  };

  // 4. Financial Composition
  composition: {
    cashPosition: number; // as of asOfDate
    bankAccountsTotal: number;
    cashAccountsTotal: number;
    accounts: {
      id: string;
      name: string;
      type: 'bank' | 'cash';
      institution?: string | null;
      calculatedBalance: number; // current balance today
      asOfBalance: number;       // reconstructed balance as of period end date
      sharePercentage: number;
      lastReconciledAt?: string | null;
      isActive: boolean;
      isReconciled: boolean;
    }[];
    untrackedClasses: {
      name: string;
      status: string;
      description: string;
    }[];
  };

  // 5. Lifetime Summary
  lifetimeSummary: {
    lifetimeGrossIncome: number;
    lifetimeNetTaxPaid: number;
    lifetimeConsumptionExpenses: number;
    lifetimeTotalExpenses: number;
    lifetimeSavings: number;
    lifetimeInvestmentAllocation: number;
    totalPostedTransactions: number;
    totalActiveAccounts: number;
    earliestTransactionDate: string | null;
    disclaimer: string;
  };

  // 6. Objective Financial Health Indicators
  financialHealth: {
    savingsRate: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    cashRunwayMonths: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    debtRatio: {
      value: number;
      formatted: string;
      formula: string;
      description: string;
    };
    effectiveTaxRate: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
    expenseToIncomeRatio: {
      value: number | null;
      formatted: string;
      formula: string;
      description: string;
    };
  };

  // 7. Spending by Category
  categoryBreakdown: {
    categoryId: string;
    categoryName: string;
    color: string;
    icon: string;
    amount: number;
    percentage: number;
  }[];

  // 8. Monthly Trends (taxes subtracted for true net savings)
  monthlyTrends: {
    monthKey: string;
    label: string;
    grossIncome: number;
    netTaxPaid: number;
    netIncome: number;
    expenses: number;
    savings: number;
    netCashFlow: number;
  }[];

  // 9. Recent Activity Snippet
  recentTransactions: {
    id: string;
    transactionDate: string;
    description: string;
    amount: number;
    type: string;
    categoryName?: string;
    accountName?: string;
  }[];
}
