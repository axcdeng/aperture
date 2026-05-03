'use client';

import Link from 'next/link';
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
    <div className="flex min-h-screen w-full">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-background lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <Logo />
          <span className="font-semibold tracking-tight">VEX Scout</span>
        </div>
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
        <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 lg:hidden">
          <Logo />
          <span className="font-semibold">VEX Scout</span>
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#1f4c7a] bg-gradient-to-br from-[#0c2540] to-[#08121f]">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7dd3fc]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4l7 16 4-9 7 9" />
      </svg>
    </div>
  );
}
