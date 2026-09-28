import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;

export function isFirebaseConfigured(): boolean {
  return !!(
    environment.firebase.apiKey &&
    environment.firebase.projectId
  );
}

export function getFirebaseClientApp(): { app: FirebaseApp | null; auth: Auth | null; db: Firestore | null } {
  if (!isFirebaseConfigured()) {
    return { app: null, auth: null, db: null };
  }

  if (!firebaseApp) {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
    firebaseAuth = getAuth(firebaseApp);
    const dbId = environment.firebase.firestoreDatabaseId;
    firestoreDb = dbId && dbId !== '(default)'
      ? getFirestore(firebaseApp, dbId)
      : getFirestore(firebaseApp);
  }

  return {
    app: firebaseApp,
    auth: firebaseAuth,
    db: firestoreDb,
  };
}
