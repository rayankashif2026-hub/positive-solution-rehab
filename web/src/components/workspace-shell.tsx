"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use } from "react";
import {
  Activity,
  Apple,
  Brain,
  Bell,
  CalendarDays,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  Dumbbell,
  FileBarChart2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  Wrench,
  X,
  Droplets,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { logout } from "@/app/login/actions";
import AssistantChat from "@/components/assistant-chat";
import type { NavigationItem } from "@/lib/navigation";

type WorkspaceShellProps = {
  children: ReactNode;
  fullName: string;
  username: string;
  navItems: NavigationItem[];
  dueFollowupCount: Promise<number> | null;
};

function FollowupNotification({ countPromise }: { countPromise: Promise<number> }) {
  const dueFollowupCount = use(countPromise);

  return (
    <Link
      aria-label={`${dueFollowupCount} follow-ups due today`}
      className="notification-link"
      href="/modules/followups"
      title={`${dueFollowupCount} follow-ups due today`}
    >
      <Bell aria-hidden="true" size={18} />
      {dueFollowupCount > 0 && (
        <span className="notification-badge">
          {dueFollowupCount > 99 ? "99+" : dueFollowupCount}
        </span>
      )}
      <span className="sr-only">Follow-ups due today</span>
    </Link>
  );
}

function iconForHref(href: string) {
  if (href === "/dashboard") return LayoutDashboard;
  if (href.includes("patient")) return Users;
  if (href.includes("appointment")) return CalendarDays;
  if (href.includes("physiotherapy")) return Activity;
  if (href.includes("psychology")) return Brain;
  if (href.includes("hijama")) return Droplets;
  if (href.includes("nutrition")) return Apple;
  if (href.includes("exercise")) return Dumbbell;
  if (href.includes("attendance")) return ClipboardCheck;
  if (href.includes("staff")) return Stethoscope;
  if (href.includes("followup")) return CalendarClock;
  if (href.includes("invoice") || href.includes("payment")) return Wallet;
  if (href.includes("inventory")) return Package;
  if (href.includes("equipment")) return Wrench;
  if (href.includes("reports")) return FileBarChart2;
  if (href.includes("admin")) return ShieldCheck;
  return FileText;
}

function groupForHref(href: string): string {
  if (
    href.includes("staff") ||
    href.includes("attendance") ||
    href.includes("followup") ||
    href.includes("inventory") ||
    href.includes("equipment")
  ) {
    return "Operations";
  }
  if (
    href.includes("invoice") ||
    href.includes("payment") ||
    href.includes("reports") ||
    href.includes("admin")
  ) {
    return "Management";
  }
  return "Clinical services";
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export default function WorkspaceShell({
  children,
  fullName,
  username,
  navItems,
  dueFollowupCount,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navSearch, setNavSearch] = useState("");

  const groups = useMemo(() => {
    const filtered = navItems.filter((item) =>
      item.label.toLowerCase().includes(navSearch.trim().toLowerCase()),
    );
    return [
      { label: "Clinical services", items: filtered.filter((item) => groupForHref(item.href) === "Clinical services") },
      { label: "Operations", items: filtered.filter((item) => groupForHref(item.href) === "Operations") },
      { label: "Management", items: filtered.filter((item) => groupForHref(item.href) === "Management") },
    ].filter((group) => group.items.length > 0);
  }, [navItems, navSearch]);

  const currentLabel =
    navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label ??
    "Overview";

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`} id="workspace-sidebar">
        <Link className="brand" href="/dashboard" onClick={() => setSidebarOpen(false)}>
          <span className="brand-art">
            <Image
              alt="Positive Solutions Rehab Center logo"
              className="sidebar-logo"
              height={88}
              priority
              src="/positive-solutions-logo.png"
              width={88}
            />
          </span>
          <span className="brand-copy">
            <span className="brand-name">Positive Solutions</span>
            <span className="brand-caption">Rehab Center · Wah Cantt</span>
          </span>
        </Link>

        <label className="nav-search">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">Filter navigation</span>
          <input
            onChange={(event) => setNavSearch(event.target.value)}
            placeholder="Find a workspace"
            type="search"
            value={navSearch}
          />
        </label>

        <nav aria-label="Main navigation" className="workspace-nav">
          <Link
            aria-current={pathname === "/dashboard" ? "page" : undefined}
            className="nav-link"
            href="/dashboard"
            onClick={() => setSidebarOpen(false)}
          >
            <LayoutDashboard aria-hidden="true" size={18} />
            <span>Overview</span>
          </Link>
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              <div className="nav-list">
                {group.items.map((item) => {
                  const Icon = iconForHref(item.href);
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className="nav-link"
                      href={item.href}
                      key={item.href}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Icon aria-hidden="true" size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <details className="profile-menu">
            <summary className="sidebar-profile">
              <span aria-hidden="true" className="profile-avatar">{initials(fullName)}</span>
              <span className="profile-details">
                <strong>{fullName}</strong>
                <small>@{username}</small>
              </span>
              <ChevronDown aria-hidden="true" className="profile-chevron" size={16} />
            </summary>
            <div className="profile-menu-content">
              <span>Signed in as {username}</span>
              <form action={logout}>
                <button className="signout-button" type="submit">
                  <LogOut aria-hidden="true" size={16} />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          </details>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <button
            aria-controls="workspace-sidebar"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            className="mobile-menu"
            onClick={() => setSidebarOpen((open) => !open)}
            type="button"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="topbar-heading">
            <span className="topbar-kicker">CLINIC WORKSPACE</span>
            <strong>{currentLabel}</strong>
          </div>
          {dueFollowupCount && (
            <Suspense
              fallback={
                <span aria-hidden="true" className="notification-link">
                  <Bell size={18} />
                </span>
              }
            >
              <FollowupNotification countPromise={dueFollowupCount} />
            </Suspense>
          )}
          <div className="topbar-session">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>Secure session</span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      <AssistantChat />
    </div>
  );
}
