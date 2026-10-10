import { describe, it, expect, beforeEach } from 'vitest';
import { setFirebaseAdminForTesting } from './firebase-admin.js';
import {
  createEmptyProjection,
  rebuildProjectionFromLedger,
  getOrBuildProjection,
  recordTransactionCreatedInProjection,
  recordTransactionVoidedInProjection,
  recordTransactionUpdatedInProjection,
  recordInternalTransferCreatedInProjection,
  markProjectionStale,
  verifyProjectionConsistency,
  ProjectionMutationEvent,
  DashboardProjection,
  ProjectionTxMarker,
} from './projection-service.js';
import type { TransactionDocument } from './transaction-service.js';

describe('Projection Service: Atomicity, Scalability, and Concurrency', () => {
  const userId = 'user-proj-123';
  let transactionsStore: Map<string, TransactionDocument>;
  let projectionsStore: Map<string, Record<string, unknown>>;
  let markersStore: Map<string, Record<string, unknown>>;
  let outboxStore: Map<string, Record<string, unknown>>;
  let docVersions: Map<string, number>;
  let conflictHook: ((attempt: number) => boolean) | null = null;

  interface MockFilter {
    field: string;
    op: string;
    val: unknown;
  }

  interface MockOrder {
    field: string;
    dir: 'asc' | 'desc';
  }

  const createQueryBuilder = (
    store: Map<string, Record<string, unknown>>,
    filters: MockFilter[] = [],
    orderBys: MockOrder[] = [],
    limitVal?: number,
  ) => {
    return {
      where: (field: string, op: string, val: unknown) => {
        return createQueryBuilder(store, [...filters, { field, op, val }], orderBys, limitVal);
      },
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
        return createQueryBuilder(store, filters, [...orderBys, { field, dir }], limitVal);
      },
      limit: (n: number) => {
        return createQueryBuilder(store, filters, orderBys, n);
      },
      get: async () => {
        let docs = Array.from(store.values()).filter((t) => t['userId'] === userId || !t['userId']);
        for (const f of filters) {
          docs = docs.filter((t) => {
            const val = t[f.field];
            if (f.op === '==') return val === f.val;
            if (f.op === '>=') return (val as string) >= (f.val as string);
            if (f.op === '<=') return (val as string) <= (f.val as string);
            if (f.op === '>') return (val as string) > (f.val as string);
            if (f.op === '<') return (val as string) < (f.val as string);
            return true;
          });
        }
        if (orderBys.length > 0) {
          docs.sort((a, b) => {
            for (const o of orderBys) {
              const aVal = String(a[o.field] ?? '');
              const bVal = String(b[o.field] ?? '');
              const comp = o.dir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
              if (comp !== 0) return comp;
            }
            return 0;
          });
        }
        if (limitVal !== undefined) {
          docs = docs.slice(0, limitVal);
        }
        return {
          empty: docs.length === 0,
          docs: docs.map((d) => ({
            id: (d['id'] || d['txId'] || d['eventId']) as string,
            data: () => d,
            ref: {
              delete: async () => {
                const key = `${userId}/${d['id'] || d['txId'] || d['eventId']}`;
                store.delete(key);
                docVersions.set(key, (docVersions.get(key) || 0) + 1);
              },
            },
          })),
        };
      },
    };
  };

  const createDocRef = (store: Map<string, Record<string, unknown>>, path: string) => ({
    _path: path,
    get: async () => {
      const data = store.get(path);
      return {
        id: path.split('/').pop() || '',
        exists: !!data,
        data: () => data,
      };
    },
    set: async (val: Record<string, unknown>, opts?: { merge?: boolean }) => {
      if (opts?.merge) {
        const existing = store.get(path) || {};
        store.set(path, { ...existing, ...val });
      } else {
        store.set(path, val);
      }
      docVersions.set(path, (docVersions.get(path) || 0) + 1);
    },
    update: async (val: Record<string, unknown>) => {
      const existing = store.get(path) || {};
      store.set(path, { ...existing, ...val });
      docVersions.set(path, (docVersions.get(path) || 0) + 1);
    },
    delete: async () => {
      store.delete(path);
      docVersions.set(path, (docVersions.get(path) || 0) + 1);
    },
  });

  beforeEach(() => {
    transactionsStore = new Map();
    projectionsStore = new Map();
    markersStore = new Map();
    outboxStore = new Map();
    docVersions = new Map();
    conflictHook = null;

    const mockDb = {
      collection: (colName: string) => {
        if (colName !== 'users') throw new Error(`Unexpected collection ${colName}`);
        return {
          doc: (docUserId: string) => ({
            collection: (subCol: string) => {
              if (subCol === 'transactions') {
                const base = createQueryBuilder(transactionsStore as unknown as Map<string, Record<string, unknown>>);
                return {
                  ...base,
                  doc: (docId: string) => createDocRef(transactionsStore as unknown as Map<string, Record<string, unknown>>, `${docUserId}/${docId}`),
                };
              }
              if (subCol === 'projections') {
                return {
                  doc: (docId: string) => createDocRef(projectionsStore, `${docUserId}/${docId}`),
                };
              }
              if (subCol === 'projectionMarkers') {
                return {
                  doc: (docId: string) => createDocRef(markersStore, `${docUserId}/${docId}`),
                };
              }
              if (subCol === 'projectionOutbox') {
                const base = createQueryBuilder(outboxStore);
                return {
                  ...base,
                  doc: (docId: string) => createDocRef(outboxStore, `${docUserId}/${docId}`),
                };
              }
              return {
                get: async () => ({ empty: true, docs: [] }),
                doc: (docId: string) => createDocRef(new Map(), `${docUserId}/${docId}`),
              };
            },
          }),
        };
      },

      /**
       * Realistic Firestore transaction emulator:
       * - Tracks read snapshot versions on t.get(ref)
       * - Buffers writes (set, update, delete) until commit phase
       * - Detects optimistic concurrency conflicts
       * - Automatically retries up to 5 attempts
       * - Allows conflict injection hook for testing race conditions
       */
      runTransaction: async (updateFunction: (transaction: unknown) => Promise<unknown>) => {
        const MAX_TX_ATTEMPTS = 20;
        let attempt = 0;

        while (attempt < MAX_TX_ATTEMPTS) {
          attempt++;
          const readVersions = new Map<string, number>();
          const bufferedWrites: (() => void)[] = [];

          const tx = {
            get: async (ref: { _path: string; get: () => Promise<unknown> }) => {
              const path = ref._path;
              const currentVer = docVersions.get(path) || 0;
              readVersions.set(path, currentVer);
              return ref.get();
            },
            set: (
              ref: { _path: string; set: (val: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void> },
              data: Record<string, unknown>,
              opts?: { merge?: boolean },
            ) => {
              bufferedWrites.push(() => {
                ref.set(data, opts);
              });
            },
            update: (
              ref: { _path: string; update: (val: Record<string, unknown>) => Promise<void> },
              data: Record<string, unknown>,
            ) => {
              bufferedWrites.push(() => {
                ref.update(data);
              });
            },
            delete: (ref: { _path: string; delete: () => Promise<void> }) => {
              bufferedWrites.push(() => {
                ref.delete();
              });
            },
          };

          try {
            const result = await updateFunction(tx);

            // Commit validation: verify no read document modified concurrently
            let conflictDetected = false;
            for (const [path, readVer] of readVersions.entries()) {
              const currentVer = docVersions.get(path) || 0;
              if (currentVer !== readVer) {
                conflictDetected = true;
                break;
              }
            }

            if (conflictHook && conflictHook(attempt)) {
              conflictDetected = true;
            }

            if (conflictDetected) {
              const err = new Error('Firestore transaction aborted due to concurrent conflict');
              (err as unknown as { code: number }).code = 10; // ABORTED
              throw err;
            }

            // Atomic commit of all buffered writes
            for (const write of bufferedWrites) {
              write();
            }

            return result;
          } catch (err: unknown) {
            const errorCode = (err as { code?: number })?.code;
            if (errorCode === 10 && attempt < MAX_TX_ATTEMPTS) {
              await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 15) + 5));
              continue; // Retry transaction with fresh read snapshot
            }
            throw err;
          }
        }

        throw new Error(`Firestore transaction failed after ${MAX_TX_ATTEMPTS} attempts due to conflicts`);
      },
    };

    setFirebaseAdminForTesting({
      db: mockDb as unknown as FirebaseFirestore.Firestore,
      auth: null,
      app: null,
      initialized: true,
    });
  });

  it('creates an empty projection with zero balances, zero liabilities, and no unbounded metadata', () => {
    const proj = createEmptyProjection(userId);
    expect(proj.userId).toBe(userId);
    expect(proj.version).toBe(1);
    expect(proj.generation).toBe(1);
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.lifetime.consumptionExpenses).toBe(0);
    expect(proj.lifetime.totalPostedTransactions).toBe(0);
    expect(proj.debt.cumulativeDebtBorrowing).toBe(0);
    expect(proj.debt.cumulativeDebtRepayment).toBe(0);
    expect(proj.debt.outstandingDebtLiability).toBe(0);
    expect(Object.keys(proj.monthlySummaries)).toHaveLength(0);
    expect((proj as unknown as { appliedTxMeta?: unknown }).appliedTxMeta).toBeUndefined();
  });

  // 1. Scalability: Document-size-safe behavior as transaction count grows
  it('keeps projection document bounded in size as transaction count grows without storing unbounded transaction IDs', async () => {
    // Generate 100 transactions across 2 months
    for (let i = 1; i <= 100; i++) {
      const month = i % 2 === 0 ? '2026-05' : '2026-06';
      const day = String((i % 28) + 1).padStart(2, '0');
      const tx: TransactionDocument = {
        id: `tx-scale-${i}`,
        userId,
        accountId: 'acc-1',
        amount: 10000,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: `${month}-${day}`,
        description: `Income ${i}`,
        tags: [],
        notes: '',
        categoryId: null,
        counterpartyId: null,
        allocations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      transactionsStore.set(`${userId}/${tx.id}`, tx);
      await recordTransactionCreatedInProjection(userId, tx);
    }

    const proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.totalPostedTransactions).toBe(100);
    expect(proj.lifetime.grossIncome).toBe(100 * 10000);

    // Verify document does not have growing appliedTxMeta map
    expect((proj as unknown as { appliedTxMeta?: unknown }).appliedTxMeta).toBeUndefined();

    // Verify document size remains compact (well within Firestore 1 MB limit)
    const jsonStr = JSON.stringify(proj);
    expect(jsonStr.length).toBeLessThan(4000); // Less than 4 KB!

    // Verify individual per-transaction markers are stored in their own documents
    expect(markersStore.size).toBe(100);
    const marker1 = markersStore.get(`${userId}/tx-scale-1`) as unknown as ProjectionTxMarker;
    expect(marker1).toBeDefined();
    expect(marker1.status).toBe('POSTED');
    expect(marker1.amount).toBe(10000);
  });

  // 2. Retry and duplicate-event idempotency
  it('ensures create, edit, void, and paired-transfer operations can be retried without applying deltas twice', async () => {
    const tx: TransactionDocument = {
      id: 'tx-idem-1',
      userId,
      accountId: 'acc-1',
      amount: 50000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-04-10',
      description: 'Consulting',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      version: 1,
      createdAt: '2026-04-10T12:00:00.000Z',
      updatedAt: '2026-04-10T12:00:00.000Z',
    };
    transactionsStore.set(`${userId}/${tx.id}`, tx);

    // Create applied once
    await recordTransactionCreatedInProjection(userId, tx);
    let proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(50000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);

    // Duplicate create call with identical state: MUST be an idempotent no-op
    await recordTransactionCreatedInProjection(userId, tx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(50000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);

    // Edit transaction: change amount to 80000
    const updatedTx: TransactionDocument = {
      ...tx,
      amount: 80000,
      version: 2,
      updatedAt: '2026-04-10T12:00:00.000Z', // Same timestamp resolution to test non-timestamp event identity!
    };
    transactionsStore.set(`${userId}/${tx.id}`, updatedTx);

    await recordTransactionUpdatedInProjection(userId, tx, updatedTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(80000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);

    // Duplicate update call: MUST NOT apply delta twice
    await recordTransactionUpdatedInProjection(userId, tx, updatedTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(80000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);

    // Void transaction
    const voidedTx: TransactionDocument = {
      ...updatedTx,
      status: 'VOIDED',
      version: 3,
      updatedAt: '2026-04-10T12:00:00.000Z',
    };
    transactionsStore.set(`${userId}/${tx.id}`, voidedTx);

    await recordTransactionVoidedInProjection(userId, voidedTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.lifetime.totalPostedTransactions).toBe(0);

    // Duplicate void call: MUST NOT reverse delta twice
    await recordTransactionVoidedInProjection(userId, voidedTx);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.grossIncome).toBe(0);
    expect(proj.lifetime.totalPostedTransactions).toBe(0);
  });

  // 3. Process interruption after ledger commit but before projection application
  it('recovers projection automatically before dashboard reads when a crash occurs after ledger commit', async () => {
    // Simulate process crash:
    // Ledger write committed and outbox mutation event written, but process died before applyProjectionMutationEvent
    const tx: TransactionDocument = {
      id: 'tx-crash-1',
      userId,
      accountId: 'acc-1',
      amount: 250000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-07-01',
      description: 'Unprocessed Event',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      version: 1,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    };
    transactionsStore.set(`${userId}/${tx.id}`, tx);

    const outboxEvent: ProjectionMutationEvent = {
      eventId: 'evt_crash_tx-crash-1_v1',
      userId,
      eventType: 'TX_CREATED',
      createdAt: '2026-07-01T00:00:00Z',
      txId: tx.id,
      version: 1,
      tx,
    };
    outboxStore.set(`${userId}/${outboxEvent.eventId}`, outboxEvent as unknown as Record<string, unknown>);

    // Projection document currently does not have this transaction
    expect(outboxStore.size).toBe(1);

    // Ordinary dashboard request calls getOrBuildProjection
    const proj = await getOrBuildProjection(userId);

    // Confirm projection recovered and applied the pending outbox event before returning
    expect(proj.lifetime.grossIncome).toBe(250000);
    expect(proj.lifetime.totalPostedTransactions).toBe(1);
    expect(proj.lifetime.earliestTransactionDate).toBe('2026-07-01');
    expect(proj.monthlySummaries['2026-07'].grossIncome).toBe(250000);

    // Confirm outbox event was drained
    expect(outboxStore.size).toBe(0);
  });

  // 4. Concurrent create/edit/void/transfer mutations
  it('handles concurrent create, edit, void, and transfer mutations without lost updates or race corruption', async () => {
    // Concurrently create 5 income transactions, 1 borrowing, and 1 internal transfer
    const tasks: Promise<void>[] = [];

    for (let i = 1; i <= 5; i++) {
      const tx: TransactionDocument = {
        id: `tx-conc-${i}`,
        userId,
        accountId: 'acc-1',
        amount: 20000 * i,
        type: 'INCOME',
        status: 'POSTED',
        transactionDate: `2026-08-0${i}`,
        description: `Income ${i}`,
        tags: [],
        notes: '',
        categoryId: null,
        counterpartyId: null,
        allocations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      transactionsStore.set(`${userId}/${tx.id}`, tx);
      tasks.push(recordTransactionCreatedInProjection(userId, tx));
    }

    const borrowTx: TransactionDocument = {
      id: 'tx-conc-borrow',
      userId,
      accountId: 'acc-1',
      amount: 100000,
      type: 'DEBT_BORROWING',
      status: 'POSTED',
      transactionDate: '2026-08-01',
      description: 'Loan',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${borrowTx.id}`, borrowTx);
    tasks.push(recordTransactionCreatedInProjection(userId, borrowTx));

    const sourceTx: TransactionDocument = {
      id: 'tx-conc-xfer-src',
      userId,
      accountId: 'acc-1',
      destinationAccountId: 'acc-2',
      amount: 50000,
      type: 'INTERNAL_TRANSFER',
      transferDirection: 'OUT',
      status: 'POSTED',
      transferGroupId: 'grp-conc-xfer',
      transactionDate: '2026-08-02',
      description: 'Transfer Out',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const destTx: TransactionDocument = {
      id: 'tx-conc-xfer-dst',
      userId,
      accountId: 'acc-2',
      destinationAccountId: 'acc-1',
      amount: 50000,
      type: 'INTERNAL_TRANSFER',
      transferDirection: 'IN',
      status: 'POSTED',
      transferGroupId: 'grp-conc-xfer',
      transactionDate: '2026-08-02',
      description: 'Transfer In',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${sourceTx.id}`, sourceTx);
    transactionsStore.set(`${userId}/${destTx.id}`, destTx);
    tasks.push(recordInternalTransferCreatedInProjection(userId, sourceTx, destTx));

    // Run all mutations concurrently
    await Promise.all(tasks);

    // Verify consistency
    const verification = await verifyProjectionConsistency(userId);
    expect(verification.isConsistent).toBe(true);
    expect(verification.discrepancies).toHaveLength(0);
    expect(verification.storedProjection.lifetime.totalPostedTransactions).toBe(8); // 5 income + 1 debt + 2 transfer legs
    expect(verification.storedProjection.debt.outstandingDebtLiability).toBe(100000);
    expect(verification.storedProjection.lifetime.grossIncome).toBe(20000 + 40000 + 60000 + 80000 + 100000);
  });

  // 5. Rebuild conflicts and exhausted retries
  it('protects rebuild with generation fencing against concurrent mutations and avoids un-fenced direct writes', async () => {
    // Initial transaction
    const initialTx: TransactionDocument = {
      id: 'tx-rb-1',
      userId,
      accountId: 'acc-1',
      amount: 100000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-03-01',
      description: 'Base Income',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${initialTx.id}`, initialTx);
    await rebuildProjectionFromLedger(userId);

    const initialProj = await getOrBuildProjection(userId);
    expect(initialProj.lifetime.grossIncome).toBe(100000);
    const initialGen = initialProj.generation;

    // Test successful rebuild after simulated transient conflict (attempt 1 conflicts, attempt 2 succeeds)
    conflictHook = (attempt: number) => attempt === 1;
    const rebuiltProj = await rebuildProjectionFromLedger(userId);
    expect(rebuiltProj.generation).toBe(initialGen + 1);
    expect(rebuiltProj.lifetime.grossIncome).toBe(100000);
    conflictHook = null;

    // Test exhausted retries: all 5 attempts conflict
    // Rebuild MUST NOT perform unconditional direct write; it must mark stale and abort safely
    conflictHook = () => true;
    await expect(rebuildProjectionFromLedger(userId)).rejects.toThrow(
      /Projection rebuild aborted after 5 attempts due to concurrent ledger mutations/,
    );
    conflictHook = null;

    // Check that projection is marked stale so subsequent reads know it requires repair
    const staleProj = projectionsStore.get(`${userId}/dashboard`) as unknown as DashboardProjection;
    expect(staleProj.isStale).toBe(true);
    expect(staleProj.staleReason).toContain('REBUILD_CONFLICT');
  });

  // 6. Earliest-date changes racing with edits or voids
  it('safely recalculates earliestTransactionDate when earliest transaction is voided or edited', async () => {
    const txEarly: TransactionDocument = {
      id: 'tx-date-early',
      userId,
      accountId: 'acc-1',
      amount: 50000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-01-05',
      description: 'Earliest Transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      version: 1,
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-01-05T00:00:00Z',
    };

    const txMiddle: TransactionDocument = {
      id: 'tx-date-mid',
      userId,
      accountId: 'acc-1',
      amount: 75000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-02-15',
      description: 'Middle Transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      version: 1,
      createdAt: '2026-02-15T00:00:00Z',
      updatedAt: '2026-02-15T00:00:00Z',
    };

    transactionsStore.set(`${userId}/${txEarly.id}`, txEarly);
    transactionsStore.set(`${userId}/${txMiddle.id}`, txMiddle);

    await recordTransactionCreatedInProjection(userId, txEarly);
    await recordTransactionCreatedInProjection(userId, txMiddle);

    let proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.earliestTransactionDate).toBe('2026-01-05');

    // Void the earliest transaction (txEarly)
    const voidedEarly: TransactionDocument = {
      ...txEarly,
      status: 'VOIDED',
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${txEarly.id}`, voidedEarly);

    await recordTransactionVoidedInProjection(userId, voidedEarly);
    proj = await getOrBuildProjection(userId);

    // Earliest date must now accurately advance to 2026-02-15
    expect(proj.lifetime.earliestTransactionDate).toBe('2026-02-15');

    // Now edit txMiddle to move its date forward to 2026-04-01
    const movedMiddle: TransactionDocument = {
      ...txMiddle,
      transactionDate: '2026-04-01',
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${txMiddle.id}`, movedMiddle);

    await recordTransactionUpdatedInProjection(userId, txMiddle, movedMiddle);
    proj = await getOrBuildProjection(userId);

    // Earliest date updates to 2026-04-01
    expect(proj.lifetime.earliestTransactionDate).toBe('2026-04-01');

    // Add a new earliest transaction (2025-11-20)
    const txAncient: TransactionDocument = {
      id: 'tx-date-ancient',
      userId,
      accountId: 'acc-1',
      amount: 10000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2025-11-20',
      description: 'Ancient Transaction',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      version: 1,
      createdAt: '2025-11-20T00:00:00Z',
      updatedAt: '2025-11-20T00:00:00Z',
    };
    transactionsStore.set(`${userId}/${txAncient.id}`, txAncient);

    await recordTransactionCreatedInProjection(userId, txAncient);
    proj = await getOrBuildProjection(userId);
    expect(proj.lifetime.earliestTransactionDate).toBe('2025-11-20');
  });

  // 7. Projection recovery before dashboard data is served
  it('triggers safe repair rebuild before dashboard reads when projection is marked stale', async () => {
    const tx: TransactionDocument = {
      id: 'tx-stale-repair',
      userId,
      accountId: 'acc-1',
      amount: 120000,
      type: 'INCOME',
      status: 'POSTED',
      transactionDate: '2026-09-10',
      description: 'Repair Test',
      tags: [],
      notes: '',
      categoryId: null,
      counterpartyId: null,
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    transactionsStore.set(`${userId}/${tx.id}`, tx);
    await recordTransactionCreatedInProjection(userId, tx);

    // Manually mark projection stale (e.g. from prior failure or external detection)
    await markProjectionStale(userId, 'CORRUPTED_CACHE_DETECTED');

    const staleSnap = projectionsStore.get(`${userId}/dashboard`) as unknown as DashboardProjection;
    expect(staleSnap.isStale).toBe(true);

    // Ordinary dashboard request calls getOrBuildProjection
    const repairedProj = await getOrBuildProjection(userId);

    // Confirms repair happened before returning results
    expect(repairedProj.isStale).toBe(false);
    expect(repairedProj.staleReason).toBeNull();
    expect(repairedProj.lifetime.grossIncome).toBe(120000);
    expect(repairedProj.rebuiltAt).toBeDefined();

    // Consistency check confirms 100% agreement
    const check = await verifyProjectionConsistency(userId);
    expect(check.isConsistent).toBe(true);
  });
});
