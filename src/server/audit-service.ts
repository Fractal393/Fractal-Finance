import { getFirebaseAdmin } from './firebase-admin.js';

export interface AuditEntryInput {
  userId: string;
  actor: string;
  action:
    | 'ACCOUNT_CREATED'
    | 'ACCOUNT_EDITED'
    | 'OPENING_BALANCE_CHANGED'
    | 'ACCOUNT_STATUS_CHANGED'
    | 'RECONCILIATION_ADJUSTMENT'
    | 'BALANCE_SNAPSHOT_RECORDED'
    | 'TRANSACTION_CREATED'
    | 'TRANSACTION_EDITED'
    | 'TRANSACTION_VOIDED'
    | 'TRANSFER_CREATED'
    | 'TRANSFER_EDITED'
    | 'ACCOUNT_BALANCE_RECALCULATED'
    | 'SPLIT_TRANSACTION_CREATED'
    | 'SPLIT_TRANSACTION_EDITED'
    | 'CATEGORY_CREATED'
    | 'CATEGORY_EDITED'
    | 'COUNTERPARTY_CREATED'
    | 'COUNTERPARTY_EDITED'
    | 'TAG_CREATED'
    | 'TAG_EDITED';
  entityType:
    | 'account'
    | 'balanceSnapshot'
    | 'transaction'
    | 'transfer'
    | 'category'
    | 'counterparty'
    | 'tag';
  entityId: string;
  details: Record<string, unknown>;
}

export interface AuditRecord extends AuditEntryInput {
  id: string;
  timestamp: string;
}

/**
 * Trusted server-side audit service.
 * Inserts immutable audit records into users/{userId}/audit.
 * Clients have write: false in Firestore security rules.
 */
export async function createAuditRecord(input: AuditEntryInput): Promise<AuditRecord> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore database is not initialized on the server.');
  }

  const auditRef = db.collection('users').doc(input.userId).collection('audit').doc();
  const timestamp = new Date().toISOString();

  const auditRecord: AuditRecord = {
    id: auditRef.id,
    userId: input.userId,
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details,
    timestamp,
  };

  await auditRef.set(auditRecord);
  return auditRecord;
}
