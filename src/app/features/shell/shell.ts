import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DesktopSidebar } from './desktop-sidebar';
import { DesktopHeader } from './desktop-header';
import { MobileNav } from './mobile-nav';
import { QuickAddModal } from './quick-add-modal';
import { PinLockOverlay } from './pin-lock-overlay';
import { PinLockService } from '../../core/security/pin-lock.service';
import { AuthService } from '../../core/auth/auth.service';
import { QuickAddService } from '../../core/transactions/quick-add.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, DesktopSidebar, DesktopHeader, MobileNav, QuickAddModal, PinLockOverlay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)] flex flex-col md:flex-row antialiased">
      <!-- Desktop Sidebar (md+) -->
      <div class="hidden md:block">
        <app-desktop-sidebar />
      </div>

      <!-- Main Viewport Container -->
      <div class="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <!-- Desktop Header (md+) -->
        <div class="hidden md:block">
          <app-desktop-header />
        </div>

        <!-- Mobile Header (Mobile only) -->
        <header class="md:hidden h-14 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between select-none">
          <div class="flex items-center space-x-2">
            <div class="w-6 h-6 rounded bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-xs tracking-wider">
              FF
            </div>
            <span class="font-editorial text-base font-semibold text-[var(--color-ink)]">Fractal Finance</span>
          </div>
          <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--color-canvas)] border border-[var(--color-border)] text-[var(--color-secondary)]">
            Active
          </span>
        </header>

        <!-- Routed Content Outlet -->
        <main class="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          <router-outlet />
        </main>
      </div>

      <!-- Mobile Bottom Navigation (Mobile only) -->
      <app-mobile-nav (quickAddClicked)="quickAddService.open()" />

      <!-- Quick Add Sheet / Modal -->
      <app-quick-add-modal
        [isOpen]="quickAddService.isOpen()"
        (closed)="quickAddService.close()"
      />

      <!-- PIN Lock Screen Overlay -->
      <app-pin-lock-overlay />
    </div>
  `,
})
export class Shell implements OnInit {
  private readonly pinLock = inject(PinLockService);
  private readonly authService = inject(AuthService);
  readonly quickAddService = inject(QuickAddService);

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.pinLock.checkStatus();
    }
  }
}
