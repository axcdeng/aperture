'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Search, MessageSquare, Images, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Tag, ORGANIZE_CHANGED_EVENT, globalTags, loadOrganize } from '@/lib/folders';

const NAV_SCOUT = [
  { href: '/search', label: 'Search', icon: Search },
  { href: '/browse', label: 'Discord', icon: MessageSquare },
  { href: '/albums', label: 'Albums', icon: Images },
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

// Sidebar section listing global tags (with their colors). Reads the local
// store and refreshes live when tags change (custom event) or another tab
// updates localStorage.
function TagsNav({ pathname }: { pathname: string }) {
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    const load = () => setTags(globalTags(loadOrganize()));
    load();
    window.addEventListener(ORGANIZE_CHANGED_EVENT, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(ORGANIZE_CHANGED_EVENT, load);
      window.removeEventListener('storage', load);
    };
  }, []);

  return (
    <div className="space-y-1">
      <Link
        href="/tags"
        className={cn(
          'flex items-center gap-2 px-2.5 pb-1 text-[10px] uppercase tracking-wider transition-colors',
          pathname.startsWith('/tags') ? 'text-foreground' : 'text-muted-2 hover:text-foreground',
        )}
      >
        <TagIcon className="h-3 w-3" /> Tags
      </Link>
      {tags.map((t) => (
        <Link
          key={t.id}
          href={`/tags#tag-${t.id}`}
          className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: t.color }} />
          <span className="truncate">{t.name}</span>
        </Link>
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
          <TagsNav pathname={pathname} />
        </nav>
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
