import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-desktop-sidebar',
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="w-60 h-screen flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] select-none">
      <!-- Monogram and App Title -->
      <div class="p-6 border-b border-[var(--color-border)] flex items-center space-x-3">
        <div class="w-8 h-8 rounded bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-sm tracking-wider">
          FF
        </div>
        <div>
          <h1 class="font-editorial text-lg font-semibold tracking-tight text-[var(--color-ink)] leading-none">
            Fractal Finance
          </h1>
          <p class="text-xs text-[var(--color-secondary)] uppercase tracking-widest mt-1 font-mono">
            Operating System
          </p>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 py-6 px-3 space-y-1">
        @for (item of navItems; track item.label) {
          <a
            [routerLink]="item.path"
            routerLinkActive="bg-[var(--color-canvas)] text-[var(--color-ink)] font-semibold border-l-2 border-[var(--color-accent)] shadow-xs"
            [routerLinkActiveOptions]="{ exact: item.exact }"
            class="flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm text-[var(--color-secondary)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas)] transition-colors duration-150"
          >
            <mat-icon class="text-[18px] w-[18px] h-[18px] text-[var(--color-secondary)]">{{ item.icon }}</mat-icon>
            <span class="tracking-wide">{{ item.label }}</span>
          </a>
        }
      </nav>

      <!-- Footer system indicator -->
      <div class="p-4 border-t border-[var(--color-border)] text-xs text-[var(--color-secondary)] flex items-center justify-between">
        <span class="font-mono text-[11px]">Financial OS</span>
        <span class="inline-flex items-center space-x-1 text-[var(--color-accent)] font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-positive)]"></span>
          <span>Ledger Synced</span>
        </span>
      </div>
    </aside>
  `,
})
export class DesktopSidebar {
  readonly navItems = [
    { label: 'Home', path: '/', icon: 'home', exact: true },
    { label: 'Transactions', path: '/transactions', icon: 'receipt_long', exact: false },
    { label: 'Accounts', path: '/accounts', icon: 'account_balance', exact: false },
    { label: 'Investments', path: '/investments', icon: 'trending_up', exact: false },
    { label: 'More', path: '/more', icon: 'more_horiz', exact: false },
  ];
}
