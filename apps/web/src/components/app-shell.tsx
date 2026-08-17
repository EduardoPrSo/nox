'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, LockKeyhole, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { desktopNavigation, mobileNavigation, productMark } from '@/lib/navigation';
import { NoxOrb } from './nox-orb';

function isCurrent(pathname: string, href: string) {
  if (href.includes('?')) return false;
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href.split('?')[0] ?? href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ProductIcon = productMark.icon;

  return (
    <div className="product-shell">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <aside className="desktop-sidebar" aria-label="Navegação principal">
        <Link className="brand" href="/" aria-label="NOX Home">
          <span className="brand-mark">
            <ProductIcon aria-hidden="true" size={20} strokeWidth={1.7} />
          </span>
          <span>
            <strong>NOX</strong>
            <small>Personal intelligence</small>
          </span>
        </Link>

        <nav className="desktop-nav">
          {desktopNavigation.map((item) => {
            const Icon = item.icon;
            const current = item.available && isCurrent(pathname, item.href);
            return item.available ? (
              <Link key={item.href} className="nav-link" data-current={current} href={item.href}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
                <span>{item.label}</span>
                {current ? <span className="nav-current-dot" /> : null}
              </Link>
            ) : (
              <span
                key={item.href}
                className="nav-link nav-link-disabled"
                title="Disponível nas próximas etapas"
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
                <span>{item.label}</span>
                <small>soon</small>
              </span>
            );
          })}
        </nav>

        <div className="sidebar-presence">
          <NoxOrb state="EKO_ACTIVE" size="mini" label={false} />
          <div>
            <strong>Eko está ouvindo</strong>
            <span>Privacidade ativa · 24 h</span>
          </div>
          <ChevronRight aria-hidden="true" size={16} />
        </div>

        <div className="account-chip">
          <span className="avatar">EP</span>
          <span>
            <strong>Eduardo</strong>
            <small>Conta pessoal</small>
          </span>
          <ChevronRight aria-hidden="true" size={16} />
        </div>
      </aside>

      <div className="product-stage">
        <header className="topbar">
          <Link className="mobile-brand" href="/">
            <ProductIcon aria-hidden="true" size={19} />
            <strong>NOX</strong>
          </Link>
          <div className="topbar-context">
            <LockKeyhole aria-hidden="true" size={14} />
            <span>Sessão protegida</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button desktop-only" type="button" aria-label="Buscar">
              <Search aria-hidden="true" size={18} />
            </button>
            <button
              className="icon-button notification-button"
              type="button"
              aria-label="Notificações"
            >
              <Bell aria-hidden="true" size={18} />
              <span className="notification-dot" />
            </button>
            <span className="avatar avatar-small">EP</span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {mobileNavigation.map((item) => {
          const Icon = item.icon;
          const current = item.available && isCurrent(pathname, item.href);
          return item.available ? (
            <Link key={item.href} data-current={current} href={item.href}>
              <Icon aria-hidden="true" size={20} strokeWidth={current ? 2.2 : 1.7} />
              <span>{item.label}</span>
            </Link>
          ) : (
            <span key={item.href} aria-disabled="true">
              <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
              <span>{item.label}</span>
            </span>
          );
        })}
      </nav>
    </div>
  );
}
