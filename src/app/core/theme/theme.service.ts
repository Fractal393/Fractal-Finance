import { Injectable, signal, effect } from '@angular/core';

export type AppTheme = 'light' | 'dark';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly storageKey = 'pfs_theme_preference';
  readonly theme = signal<AppTheme>(this.getInitialTheme());

  constructor() {
    effect(() => {
      const current = this.theme();
      if (typeof window !== 'undefined') {
        const root = document.documentElement;
        if (current === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        try {
          localStorage.setItem(this.storageKey, current);
        } catch {
          // Ignore localStorage errors in restricted environments
        }
      }
    });
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'light' ? 'dark' : 'light'));
  }

  setTheme(theme: AppTheme): void {
    this.theme.set(theme);
  }

  private getInitialTheme(): AppTheme {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(this.storageKey) as AppTheme | null;
        if (saved === 'light' || saved === 'dark') {
          return saved;
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          return 'dark';
        }
      } catch {
        // Fallback to light
      }
    }
    return 'light';
  }
}
