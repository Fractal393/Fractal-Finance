export type TransactionType =
  | 'INCOME'
  | 'EXPENSE'
  | 'INTERNAL_TRANSFER'
  | 'INVESTMENT_ALLOCATION'
  | 'TAX'
  | 'MONEY_LENT'
  | 'RECEIVABLE_REPAYMENT'
  | 'DEBT_BORROWING'
  | 'DEBT_REPAYMENT'
  | 'NON_FINANCIAL_ASSET_PURCHASE'
  | 'RECONCILIATION_ADJUSTMENT';

export type TransactionStatus = 'POSTED' | 'VOIDED';

export type TransferDirection = 'OUT' | 'IN';

export interface SemanticClassification {
  isIncome: boolean;
  isOrdinaryExpense: boolean;
  isTotalExpense: boolean;
  isConsumptionExpense: boolean;
  isTax: boolean;
  isTransfer: boolean;
  isInvestmentAllocation: boolean;
  isReceivableMovement: boolean;
  isDebtMovement: boolean;
  isAssetPurchase: boolean;
  accountCashFlowSign: 1 | -1 | 0;
}

/**
 * Classifies a transaction according to the locked semantic model.
 * Guarantees that non-income movements (borrowing, repayments) are not treated as income,
 * and non-expense movements (investments, loans, asset purchases) are strictly differentiated.
 */
export function classifyTransaction(
  type: TransactionType,
  transferDirection?: TransferDirection | null,
): SemanticClassification {
  switch (type) {
    case 'INCOME':
      return {
        isIncome: true,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: 1,
      };

    case 'EXPENSE':
      return {
        isIncome: false,
        isOrdinaryExpense: true,
        isTotalExpense: true,
        isConsumptionExpense: true,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: -1,
      };

    case 'INTERNAL_TRANSFER':
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: true,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: transferDirection === 'IN' ? 1 : -1,
      };

    case 'INVESTMENT_ALLOCATION':
      // Moves money into investments. Allocation of savings, NOT an expense.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: true,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: -1,
      };

    case 'TAX':
      // Tracked separately from ordinary expenses. Contributes to Net Tax Paid, not Consumption Expenses.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: true,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: -1,
      };

    case 'MONEY_LENT':
      // Reduces cash and creates/updates a receivable. NOT an expense.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: true,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: -1,
      };

    case 'RECEIVABLE_REPAYMENT':
      // Increases cash and reduces a receivable. NOT ordinary income.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: true,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: 1,
      };

    case 'DEBT_BORROWING':
      // Increases cash and creates/updates a liability. NOT income.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: true,
        isAssetPurchase: false,
        accountCashFlowSign: 1,
      };

    case 'DEBT_REPAYMENT':
      // Reduces cash and liability principal. NOT ordinary expense.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: true,
        isAssetPurchase: false,
        accountCashFlowSign: -1,
      };

    case 'NON_FINANCIAL_ASSET_PURCHASE':
      // Reduces cash and increases asset value.
      // Counts toward Total Expenses, but EXCLUDED from Consumption Expenses.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: true,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: true,
        accountCashFlowSign: -1,
      };

    case 'RECONCILIATION_ADJUSTMENT':
      // Reconciliation adjustment ledger event. Cash impact matches the adjustment amount's sign.
      return {
        isIncome: false,
        isOrdinaryExpense: false,
        isTotalExpense: false,
        isConsumptionExpense: false,
        isTax: false,
        isTransfer: false,
        isInvestmentAllocation: false,
        isReceivableMovement: false,
        isDebtMovement: false,
        isAssetPurchase: false,
        accountCashFlowSign: 1, // Uses raw signed amount directly
      };

    default: {
      const _exhaustiveCheck: never = type;
      throw new Error(`Unhandled transaction type: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Calculates the delta that a posted transaction applies to the account balance.
 * Returns signed integer minor units (paise).
 * E.g., for an EXPENSE of 50000, returns -50000.
 * For an INCOME of 100000, returns +100000.
 * For a RECONCILIATION_ADJUSTMENT, returns the signed amount directly.
 */
export function getTransactionBalanceDelta(
  type: TransactionType,
  amount: number,
  status: TransactionStatus,
  transferDirection?: TransferDirection | null,
  reconciliationDiscrepancy?: number | null,
): number {
  if (status === 'VOIDED') {
    return 0;
  }
  if (type === 'RECONCILIATION_ADJUSTMENT') {
    if (reconciliationDiscrepancy !== undefined && reconciliationDiscrepancy !== null) {
      return reconciliationDiscrepancy;
    }
    return amount;
  }
  const { accountCashFlowSign } = classifyTransaction(type, transferDirection);
  return accountCashFlowSign * Math.abs(amount);
}
