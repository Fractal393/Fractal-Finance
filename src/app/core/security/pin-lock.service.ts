import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';

export interface PinStatusResponse {
  isConfigured: boolean;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PinLockService {
  private readonly api = inject(ApiClientService);

  readonly isLocked = signal<boolean>(false);
  readonly isConfigured = signal<boolean>(false);
  readonly checkingStatus = signal<boolean>(false);

  async checkStatus(): Promise<void> {
    this.checkingStatus.set(true);
    try {
      const res = await this.api.get<PinStatusResponse>('/api/security/pin/status');
      this.isConfigured.set(res.isConfigured);
      if (res.isConfigured && this.getStoredLockState()) {
        this.isLocked.set(true);
      }
    } catch {
      // In case user is offline or not configured
      this.isConfigured.set(false);
    } finally {
      this.checkingStatus.set(false);
    }
  }

  lockApp(): void {
    if (this.isConfigured()) {
      this.isLocked.set(true);
      this.setStoredLockState(true);
    }
  }

  async verifyPin(pin: string): Promise<boolean> {
    try {
      const res = await this.api.post<{ valid: boolean }>('/api/security/pin/verify', { pin });
      if (res.valid) {
        this.isLocked.set(false);
        this.setStoredLockState(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async setPin(pin: string): Promise<boolean> {
    try {
      const res = await this.api.post<{ success: boolean }>('/api/security/pin/set', { pin });
      if (res.success) {
        this.isConfigured.set(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to configure PIN:', err);
      return false;
    }
  }

  private getStoredLockState(): boolean {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pfs_app_locked') === 'true';
    }
    return false;
  }

  private setStoredLockState(locked: boolean): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pfs_app_locked', locked ? 'true' : 'false');
    }
  }
}
