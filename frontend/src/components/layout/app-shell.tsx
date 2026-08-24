import {
  ArrowLeftRight,
  Boxes,
  FileInput,
  FileCog,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  Scale,
  Shapes,
  Sun,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router";

import { useTheme } from "../../app/theme-context";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";

interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const primaryNavigation: NavigationItem[] = [
  { label: "Overview", path: "/", icon: LayoutDashboard },
  { label: "Transactions", path: "/transactions", icon: ArrowLeftRight },
  { label: "Accounts", path: "/accounts", icon: Landmark },
  { label: "Buckets", path: "/buckets", icon: Boxes },
  { label: "Categories", path: "/categories", icon: Shapes },
];

const workflowNavigation: NavigationItem[] = [
  { label: "Imports", path: "/imports", icon: FileInput },
  { label: "Reconciliations", path: "/reconciliations", icon: Scale },
  { label: "Rules", path: "/rules", icon: WandSparkles },
  { label: "Parser profiles", path: "/parser-profiles", icon: FileCog },
];

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-3" aria-label="Money Matrix overview">
      <span className="grid size-10 grid-cols-2 gap-1 rounded-xl bg-primary p-2 shadow-sm">
        <i className="rounded-[2px] bg-white/95" />
        <i className="rounded-[2px] bg-white/55" />
        <i className="rounded-[2px] bg-white/55" />
        <i className="rounded-[2px] bg-white/95" />
      </span>
      <span>
        <strong className="block font-display text-lg leading-none tracking-tight">Money Matrix</strong>
        <small className="mt-1 block text-[0.68rem] font-bold uppercase tracking-[0.16em] text-ink-muted">
          Personal ledger
        </small>
      </span>
    </NavLink>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="mt-9 flex min-h-0 flex-1 flex-col">
      <div className="space-y-1">
        {primaryNavigation.map((item) => (
          <NavigationLink key={item.path} item={item} onNavigate={onNavigate} />
        ))}
      </div>
      <p className="mb-2 mt-8 px-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-ink-muted">
        Workflows
      </p>
      <div className="space-y-1">
        {workflowNavigation.map((item) => (
          <NavigationLink key={item.path} item={item} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="mt-auto rounded-2xl border border-line bg-primary-soft p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Local workspace</p>
        <p className="mt-2 text-xs leading-5 text-ink-muted">Your Go API and PostgreSQL data stay on this machine.</p>
      </div>
    </nav>
  );
}

function NavigationLink({ item, onNavigate }: { item: NavigationItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
          isActive ? "bg-primary text-white shadow-sm dark:text-canvas" : "text-ink-muted hover:bg-primary-soft hover:text-ink",
        )
      }
    >
      <Icon className="size-[1.1rem]" strokeWidth={2} aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface/90 px-5 py-6 backdrop-blur lg:flex lg:flex-col">
        <Brand />
        <Navigation />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-ink/35 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(19rem,86vw)] flex-col bg-surface px-5 py-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="ghost" className="size-10 px-0" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <Navigation onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-7 lg:justify-end">
          <div className="lg:hidden">
            <Button variant="ghost" className="size-10 px-0" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          </div>
          <Button variant="ghost" className="size-10 px-0" onClick={toggleTheme} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
            {theme === "light" ? <Moon className="size-4" aria-hidden="true" /> : <Sun className="size-4" aria-hidden="true" />}
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[92rem] px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
