import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

let appInstance: App | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let isInitialized = false;

export function getFirebaseAdmin(): {
  app: App | null;
  auth: Auth | null;
  db: Firestore | null;
  initialized: boolean;
} {
  if (!isInitialized) {
    try {
      if (getApps().length === 0) {
        appInstance = initializeApp({
          projectId: firebaseConfig.projectId,
        });
      } else {
        appInstance = getApps()[0];
      }
      authInstance = getAuth(appInstance);
      const dbId = firebaseConfig.firestoreDatabaseId;
      firestoreInstance = dbId && dbId !== '(default)'
        ? getFirestore(appInstance, dbId)
        : getFirestore(appInstance);
      isInitialized = true;
    } catch (err) {
      console.warn('Firebase Admin SDK initialization deferred or credentials not present:', err);
    }
  }

  return {
    app: appInstance,
    auth: authInstance,
    db: firestoreInstance,
    initialized: isInitialized,
  };
}

export function setFirebaseAdminForTesting(custom: {
  app?: App | null;
  auth?: Auth | null;
  db?: Firestore | null;
  initialized?: boolean;
} | null): void {
  if (custom === null) {
    firestoreInstance = null;
    isInitialized = false;
    return;
  }
  if (custom.db !== undefined) firestoreInstance = custom.db;
  if (custom.auth !== undefined) authInstance = custom.auth;
  if (custom.app !== undefined) appInstance = custom.app;
  if (custom.initialized !== undefined) isInitialized = custom.initialized;
}

