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
};

const WORKSPACE_LINKS: WorkspaceLink[] = [
  { href: "/admin", label: "Books", shortLabel: "Books", description: "Write, edit, and publish", match: "exact" },
  { href: "/admin/taxonomy-review", label: "Collections", shortLabel: "Sort", description: "Collections, shelves, and topics" },
  { href: "/admin/manuscript-case", label: "Manuscripts", shortLabel: "Cases", description: "Editorial review queues" },
  { href: "/admin/atlas", label: "Atlas", shortLabel: "Atlas", description: "Maps, evidence, and review" },
  { href: "/admin/arena", label: "Arena", shortLabel: "Arena", description: "Visual source decisions" },
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
          const active = hydrated && isActive(pathname, { ...item, href: resolved });
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
        <GuardedAdminLink href="/admin/editorial">Editorial overview</GuardedAdminLink>
        <GuardedAdminLink href="/">Open public site</GuardedAdminLink>
      </div>
    </aside>
  );
}
