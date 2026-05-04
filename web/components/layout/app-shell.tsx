'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Search,
  Users,
  Layers,
  Calendar,
  ScanLine,
  StickyNote,
  Network,
  TrendingUp,
  GitCompare,
  Sparkles,
  Upload,
  Database,
  FileOutput,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_SCOUT = [
  { href: '/search', label: 'Search', icon: Search },
  { href: '/teams', label: 'Teams', icon: Users, hint: '5.2K' },
  { href: '/browse', label: 'Matches', icon: Layers },
  { href: '/events', label: 'Events', icon: Calendar },
  { href: '/pit-scans', label: 'Pit Scans', icon: ScanLine },
  { href: '/notes', label: 'Notes', icon: StickyNote },
];

const NAV_ANALYTICS = [
  { href: '/alliances', label: 'Alliances', icon: Network },
  { href: '/trends', label: 'Trends', icon: TrendingUp },
  { href: '/compare', label: 'Compare', icon: GitCompare },
  { href: '/insights', label: 'Insights', icon: Sparkles },
];

const NAV_DATA = [
  { href: '/uploads', label: 'Uploads', icon: Upload },
  { href: '/sources', label: 'Sources', icon: Database },
  { href: '/exports', label: 'Exports', icon: FileOutput },
];

function NavItem({
  href,
  label,
  icon: Icon,
  hint,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Search;
  hint?: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-surface text-foreground'
          : 'text-muted hover:bg-surface hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      {hint ? <span className="font-mono text-[10px] text-muted-2">{hint}</span> : null}
    </Link>
  );
}

function NavGroup({ label, items, pathname }: { label: string; items: typeof NAV_SCOUT; pathname: string }) {
  return (
    <div className="space-y-1">
      <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-muted-2">{label}</div>
      {items.map((it) => (
        <NavItem
          key={it.href}
          {...it}
          active={
            pathname === it.href ||
            (it.href !== '/' && pathname.startsWith(it.href)) ||
            (it.href === '/search' && pathname === '/')
          }
        />
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // Keep shell present even on detail pages.

  return (
    <div className="flex w-full">
      {/* Sidebar — sticky so it stays put when the main column scrolls. */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-background lg:sticky lg:top-0 lg:h-screen lg:flex lg:flex-col">
        <Link
          href="/"
          className="flex h-14 items-center border-b border-border px-4 hover:opacity-80 transition-opacity"
          aria-label="Aperture home"
        >
          <Logo />
        </Link>
        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          <NavGroup label="Scout" items={NAV_SCOUT} pathname={pathname} />
          <NavGroup label="Analytics" items={NAV_ANALYTICS} pathname={pathname} />
          <NavGroup label="Data" items={NAV_DATA} pathname={pathname} />
        </nav>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-md p-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-xs font-mono">
              SL
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">Scout Lead</div>
              <div className="truncate text-xs text-muted">@scout.lead</div>
            </div>
            <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
              LVL 42
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between px-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="dot" style={{ backgroundColor: '#22c55e' }} />
              Synced
            </span>
            <Settings className="h-3.5 w-3.5" />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center border-b border-border bg-background px-4 lg:hidden">
          <Link href="/" aria-label="Aperture home" className="hover:opacity-80 transition-opacity">
            <Logo />
          </Link>
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

function Logo() {
  // The asset bundles the mark + wordmark; rendered against the dark theme
  // it appears black, so we invert it so the wordmark reads white.
  return (
    <Image
      src="/aperture.png"
      alt="Aperture"
      width={1579}
      height={430}
      priority
      className="h-7 w-auto invert"
    />
  );
}
