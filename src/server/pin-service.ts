import crypto from 'node:crypto';
import { getFirebaseAdmin } from './firebase-admin.js';

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha256';

export interface PinStatus {
  isConfigured: boolean;
  updatedAt?: string;
}

/**
 * Hash a numeric PIN with PBKDF2-SHA256 using a random 32-byte salt.
 */
export function hashPin(pin: string): { hash: string; salt: string; iterations: number } {
  const salt = crypto.randomBytes(32).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return {
    hash: derivedKey.toString('hex'),
    salt,
    iterations: ITERATIONS,
  };
}

/**
 * Verify a candidate PIN against stored salt and hash.
 */
export function verifyPinCandidate(pin: string, storedHash: string, salt: string, iterations: number): boolean {
  const candidateKey = crypto.pbkdf2Sync(pin, salt, iterations, KEY_LENGTH, DIGEST);
  const candidateHash = candidateKey.toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(storedHash));
}

/**
 * Retrieve PIN status (without verifier secrets) for a user.
 */
export async function getPinStatus(uid: string): Promise<PinStatus> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore admin database not available');
  }

  const doc = await db.collection('users').doc(uid).collection('security').doc('appLock').get();
  if (!doc.exists) {
    return { isConfigured: false };
  }

  const data = doc.data();
  return {
    isConfigured: !!data?.['hash'],
    updatedAt: data?.['updatedAt'],
  };
}

/**
 * Save new PIN verifier to users/{uid}/security/appLock.
 */
export async function setPinVerifier(uid: string, pin: string): Promise<void> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore admin database not available');
  }

  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('PIN must be between 4 and 8 digits');
  }

  const { hash, salt, iterations } = hashPin(pin);
  const now = new Date().toISOString();

  await db.collection('users').doc(uid).collection('security').doc('appLock').set(
    {
      hash,
      salt,
      iterations,
      updatedAt: now,
    },
    { merge: true }
  );
}

/**
 * Verify submitted PIN against stored hash for the user.
 */
export async function verifyUserPin(uid: string, pin: string): Promise<boolean> {
  const { db } = getFirebaseAdmin();
  if (!db) {
    throw new Error('Firestore admin database not available');
  }

  const doc = await db.collection('users').doc(uid).collection('security').doc('appLock').get();
  if (!doc.exists) {
    return false;
  }

  const data = doc.data();
  if (!data?.['hash'] || !data?.['salt'] || !data?.['iterations']) {
    return false;
  }

  return verifyPinCandidate(pin, data['hash'], data['salt'], data['iterations']);
}
