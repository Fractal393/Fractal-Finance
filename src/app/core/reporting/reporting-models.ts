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

export interface DashboardReport {
  period: ReportingDateRange;
  generatedAt: string;

  netWorth: {
    totalNetWorth: number;
    cashPosition: number;
    financialAssets: number;
    nonFinancialAssets: number;
    liabilities: number;
    isFullyDerived: boolean;
    disclaimer: string;
    unavailableComponents: string[];
  };

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

  composition: {
    cashPosition: number;
    bankAccountsTotal: number;
    cashAccountsTotal: number;
    accounts: {
      id: string;
      name: string;
      type: 'bank' | 'cash';
      institution?: string | null;
      calculatedBalance: number;
      sharePercentage: number;
      lastReconciledAt?: string | null;
      isActive: boolean;
    }[];
    untrackedClasses: {
      name: string;
      status: string;
      description: string;
    }[];
  };

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

  categoryBreakdown: {
    categoryId: string;
    categoryName: string;
    color: string;
    icon: string;
    amount: number;
    percentage: number;
  }[];

  monthlyTrends: {
    monthKey: string;
    label: string;
    income: number;
    expenses: number;
    savings: number;
    netCashFlow: number;
  }[];

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
