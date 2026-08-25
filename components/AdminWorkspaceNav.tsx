"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import styles from "@/app/admin/AdminWorkspace.module.css";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";

type WorkspaceLink = {
  href: string;
  label: string;
  shortLabel: string;
  description: string;
  match?: "exact" | "prefix";
  relatedHrefs?: string[];
};

const WORKSPACE_LINKS: WorkspaceLink[] = [
  { href: "/admin", label: "Home", shortLabel: "Home", description: "What needs attention", match: "exact" },
  { href: "/admin/books", label: "Write", shortLabel: "Write", description: "Find a book and edit it" },
  { href: "/admin/organize", label: "Organize", shortLabel: "Sort", description: "Collections, shelves, and series", relatedHrefs: ["/admin/taxonomy-review"] },
  { href: "/admin/print", label: "Print", shortLabel: "Print", description: "Proofs, covers, and release gates" },
  { href: "/admin/reviews", label: "Needs you", shortLabel: "Your eyes", description: "Only decisions James must make", relatedHrefs: ["/admin/audio", "/admin/manuscript-case", "/admin/editorial", "/admin/atlas", "/admin/arena"] },
  { href: "/admin/more", label: "More", shortLabel: "More", description: "Site tools and legacy workspace", relatedHrefs: ["/admin/legacy"] },
];

function isActive(pathname: string, item: WorkspaceLink) {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const subscribeToHydration = () => () => {};

export default function AdminWorkspaceNav() {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolveAdminHref } = useAdminUnsavedChanges();

  return (
    <aside className={styles.sidebar} aria-label="JJU Workshop navigation">
      <div className={styles.sidebarBrand}>
        <span aria-hidden="true">JJ</span>
        <div>
          <strong>JJU Workshop</strong>
          <small>Protected workspace</small>
        </div>
      </div>

      <nav className={styles.workspaceNav} aria-label="Workshop areas">
        {WORKSPACE_LINKS.map(item => {
          const resolved = resolveAdminHref(item.href);
          const activeHrefs = [resolved, ...(item.relatedHrefs || []).map(resolveAdminHref)];
          const active = hydrated && activeHrefs.some(href => isActive(pathname, { ...item, href }));
          return (
            <GuardedAdminLink
              key={item.href}
              href={item.href}
              className={active ? styles.activeNavItem : styles.navItem}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.navMarker} aria-hidden="true" />
              <span className={styles.navCopy}>
                <strong className={styles.fullLabel}>{item.label}</strong>
                <strong className={styles.shortLabel}>{item.shortLabel}</strong>
                <small>{item.description}</small>
              </span>
            </GuardedAdminLink>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <GuardedAdminLink href="/admin/legacy">Open legacy workspace</GuardedAdminLink>
        <GuardedAdminLink href="/">Open public site</GuardedAdminLink>
      </div>
    </aside>
  );
}
