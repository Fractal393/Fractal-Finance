import { Injectable, signal, computed } from '@angular/core';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendEmailVerification as fbSendEmailVerification,
  onAuthStateChanged,
  reload,
} from 'firebase/auth';
import { getFirebaseClientApp, isFirebaseConfigured } from '../firebase/firebase.config';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  readonly currentUser = signal<User | null>(null);
  readonly authInitialized = signal<boolean>(false);
  readonly isConfigured = signal<boolean>(isFirebaseConfigured());

  readonly isAuthenticated = computed(() => !!this.currentUser());
  readonly isEmailVerified = computed(() => !!this.currentUser()?.emailVerified);
  readonly userEmail = computed(() => this.currentUser()?.email ?? '');
  readonly userId = computed(() => this.currentUser()?.uid ?? '');

  constructor() {
    this.initAuthListener();
  }

  private initAuthListener(): void {
    const { auth } = getFirebaseClientApp();
    if (!auth) {
      this.authInitialized.set(true);
      return;
    }

    onAuthStateChanged(auth, (user) => {
      this.currentUser.set(user);
      this.authInitialized.set(true);
    });
  }

  /**
   * Internal retrieval of the current fresh Firebase ID token.
   * NEVER exposed as an ordinary application signal.
   */
  async getIdToken(forceRefresh = false): Promise<string | null> {
    const user = this.currentUser();
    if (!user) {
      return null;
    }
    return user.getIdToken(forceRefresh);
  }

  async login(email: string, password: string): Promise<User> {
    const { auth } = getFirebaseClientApp();
    if (!auth) {
      throw new Error('Firebase Authentication is not configured yet. Please configure environment credentials.');
    }
    const credential = await signInWithEmailAndPassword(auth, email, password);
    this.currentUser.set(credential.user);
    return credential.user;
  }

  async register(email: string, password: string): Promise<User> {
    const { auth } = getFirebaseClientApp();
    if (!auth) {
      throw new Error('Firebase Authentication is not configured yet. Please configure environment credentials.');
    }
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    // Send email verification immediately upon registration
    try {
      await fbSendEmailVerification(credential.user);
    } catch (err) {
      console.warn('Initial email verification dispatch failed:', err);
    }
    this.currentUser.set(credential.user);
    return credential.user;
  }

  async resendVerificationEmail(): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No signed-in user.');
    }
    await fbSendEmailVerification(user);
  }

  async refreshUser(): Promise<void> {
    const user = this.currentUser();
    if (user) {
      await reload(user);
      // Trigger signal update
      this.currentUser.set({ ...user });
    }
  }

  async logout(): Promise<void> {
    const { auth } = getFirebaseClientApp();
    if (auth) {
      await fbSignOut(auth);
    }
    this.currentUser.set(null);
  }
}
