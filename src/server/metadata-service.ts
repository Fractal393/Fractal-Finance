import { getFirebaseAdmin } from './firebase-admin.js';
import { createAuditRecord } from './audit-service.js';

export interface CategoryDocument {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CounterpartyDocument {
  id: string;
  userId: string;
  name: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TagDocument {
  id: string;
  userId: string;
  name: string;
  color: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  type?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  parentId?: string | null;
  type?: string;
  isActive?: boolean;
}

export interface CreateCounterpartyInput {
  name: string;
  notes?: string;
}

export interface UpdateCounterpartyInput {
  name?: string;
  notes?: string;
  isActive?: boolean;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
  isActive?: boolean;
}

// Default standard category templates seeded for new users
const DEFAULT_CATEGORIES = [
  { name: 'Income', type: 'INCOME', children: ['Salary', 'Freelance', 'Interest', 'Dividends', 'Rental', 'Other Income'] },
  { name: 'Expenses', type: 'EXPENSE', children: ['Housing', 'Food', 'Transport', 'Healthcare', 'Shopping', 'Entertainment', 'Utilities', 'Education', 'Personal', 'Other'] },
  { name: 'Taxes', type: 'TAX', children: ['Income Tax', 'Other Tax'] },
];

/**
 * Initializes default category hierarchy for a user if they do not have any yet.
 */
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const categoriesCol = db.collection('users').doc(userId).collection('categories');
  const snap = await categoriesCol.limit(1).get();
  if (!snap.empty) {
    return; // Already initialized
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  for (const parent of DEFAULT_CATEGORIES) {
    const parentRef = categoriesCol.doc();
    const parentDoc: CategoryDocument = {
      id: parentRef.id,
      userId,
      name: parent.name,
      parentId: null,
      type: parent.type,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(parentRef, parentDoc);

    for (const childName of parent.children) {
      const childRef = categoriesCol.doc();
      const childDoc: CategoryDocument = {
        id: childRef.id,
        userId,
        name: childName,
        parentId: parentRef.id,
        type: parent.type,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(childRef, childDoc);
    }
  }

  await batch.commit();
}

/**
 * Lists categories for a user, auto-seeding defaults if empty.
 */
export async function getCategories(userId: string): Promise<CategoryDocument[]> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  await ensureDefaultCategories(userId);

  const snap = await db.collection('users').doc(userId).collection('categories').get();
  const list: CategoryDocument[] = [];
  snap.forEach((doc) => list.push(doc.data() as CategoryDocument));

  return list.sort((a, b) => {
    // Parent categories first, then alphabetical
    if (!a.parentId && b.parentId) return -1;
    if (a.parentId && !b.parentId) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryDocument> {
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Category name is required.');
  }

  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const parentId = input.parentId || null;
  if (parentId) {
    const parentSnap = await db.collection('users').doc(userId).collection('categories').doc(parentId).get();
    if (!parentSnap.exists) {
      throw new Error('Parent category not found.');
    }
  }

  const categoriesCol = db.collection('users').doc(userId).collection('categories');
  const catRef = categoriesCol.doc();
  const now = new Date().toISOString();

  const newCat: CategoryDocument = {
    id: catRef.id,
    userId,
    name: input.name.trim(),
    parentId,
    type: input.type?.trim().toUpperCase() || 'EXPENSE',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await catRef.set(newCat);

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'CATEGORY_CREATED',
    entityType: 'category',
    entityId: newCat.id,
    details: { name: newCat.name, parentId: newCat.parentId, type: newCat.type },
  });

  return newCat;
}

export async function updateCategory(
  userId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const catRef = db.collection('users').doc(userId).collection('categories').doc(categoryId);
  const snap = await catRef.get();
  if (!snap.exists) {
    const err = new Error(`Category ${categoryId} not found.`);
    (err as unknown as { code: string }).code = 'CATEGORY_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as CategoryDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied to category.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  const updates: Partial<CategoryDocument> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new Error('Category name cannot be empty.');
    updates.name = trimmed;
  }
  if (input.parentId !== undefined) {
    if (input.parentId === categoryId) {
      throw new Error('Category cannot be its own parent.');
    }
    updates.parentId = input.parentId || null;
  }
  if (input.type !== undefined) {
    updates.type = input.type.trim().toUpperCase();
  }
  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  await catRef.update(updates);
  const updated: CategoryDocument = { ...current, ...updates };

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'CATEGORY_EDITED',
    entityType: 'category',
    entityId: categoryId,
    details: { previous: current, updated },
  });

  return updated;
}

// -------------------------------------------------------------
// Counterparties
// -------------------------------------------------------------

export async function getCounterparties(userId: string): Promise<CounterpartyDocument[]> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const snap = await db.collection('users').doc(userId).collection('counterparties').get();
  const list: CounterpartyDocument[] = [];
  snap.forEach((doc) => list.push(doc.data() as CounterpartyDocument));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCounterparty(
  userId: string,
  input: CreateCounterpartyInput,
): Promise<CounterpartyDocument> {
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Counterparty name is required.');
  }

  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const normalizedName = input.name.trim();
  const col = db.collection('users').doc(userId).collection('counterparties');

  // Check existing to reuse/prevent duplicate
  const existingSnap = await col.where('name', '==', normalizedName).limit(1).get();
  if (!existingSnap.empty) {
    return existingSnap.docs[0].data() as CounterpartyDocument;
  }

  const ref = col.doc();
  const now = new Date().toISOString();

  const newDoc: CounterpartyDocument = {
    id: ref.id,
    userId,
    name: normalizedName,
    notes: input.notes?.trim() || '',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(newDoc);

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'COUNTERPARTY_CREATED',
    entityType: 'counterparty',
    entityId: newDoc.id,
    details: { name: newDoc.name },
  });

  return newDoc;
}

export async function updateCounterparty(
  userId: string,
  counterpartyId: string,
  input: UpdateCounterpartyInput,
): Promise<CounterpartyDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const ref = db.collection('users').doc(userId).collection('counterparties').doc(counterpartyId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new Error(`Counterparty ${counterpartyId} not found.`);
    (err as unknown as { code: string }).code = 'COUNTERPARTY_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as CounterpartyDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied to counterparty.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  const updates: Partial<CounterpartyDocument> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new Error('Counterparty name cannot be empty.');
    updates.name = trimmed;
  }
  if (input.notes !== undefined) {
    updates.notes = input.notes.trim();
  }
  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  await ref.update(updates);
  const updated: CounterpartyDocument = { ...current, ...updates };

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'COUNTERPARTY_EDITED',
    entityType: 'counterparty',
    entityId: counterpartyId,
    details: { previous: current, updated },
  });

  return updated;
}

// -------------------------------------------------------------
// Tags
// -------------------------------------------------------------

export async function getTags(userId: string): Promise<TagDocument[]> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const snap = await db.collection('users').doc(userId).collection('tags').get();
  const list: TagDocument[] = [];
  snap.forEach((doc) => list.push(doc.data() as TagDocument));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTag(userId: string, input: CreateTagInput): Promise<TagDocument> {
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Tag name is required.');
  }

  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const normalizedName = input.name.trim().toLowerCase();
  const col = db.collection('users').doc(userId).collection('tags');

  const existingSnap = await col.where('name', '==', normalizedName).limit(1).get();
  if (!existingSnap.empty) {
    return existingSnap.docs[0].data() as TagDocument;
  }

  const ref = col.doc();
  const now = new Date().toISOString();

  const newDoc: TagDocument = {
    id: ref.id,
    userId,
    name: normalizedName,
    color: input.color?.trim() || '#285F5C',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(newDoc);

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'TAG_CREATED',
    entityType: 'tag',
    entityId: newDoc.id,
    details: { name: newDoc.name },
  });

  return newDoc;
}

export async function updateTag(userId: string, tagId: string, input: UpdateTagInput): Promise<TagDocument> {
  const { db } = getFirebaseAdmin();
  if (!db) throw new Error('Firestore not initialized');

  const ref = db.collection('users').doc(userId).collection('tags').doc(tagId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new Error(`Tag ${tagId} not found.`);
    (err as unknown as { code: string }).code = 'TAG_NOT_FOUND';
    throw err;
  }

  const current = snap.data() as TagDocument;
  if (current.userId !== userId) {
    const err = new Error('Access denied to tag.');
    (err as unknown as { code: string }).code = 'ACCESS_DENIED';
    throw err;
  }

  const updates: Partial<TagDocument> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const trimmed = input.name.trim().toLowerCase();
    if (trimmed.length === 0) throw new Error('Tag name cannot be empty.');
    updates.name = trimmed;
  }
  if (input.color !== undefined) {
    updates.color = input.color.trim();
  }
  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  await ref.update(updates);
  const updated: TagDocument = { ...current, ...updates };

  await createAuditRecord({
    userId,
    actor: userId,
    action: 'TAG_EDITED',
    entityType: 'tag',
    entityId: tagId,
    details: { previous: current, updated },
  });

  return updated;
}
