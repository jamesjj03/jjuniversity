"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type AnchorHTMLAttributes,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type DirtyMap = Record<string, { dirty: boolean; label: string }>;

type AdminUnsavedContextValue = {
  adminBasePath: string;
  hasUnsavedChanges: boolean;
  setUnsaved: (source: string, dirty: boolean, label?: string) => void;
  confirmNavigation: () => boolean;
  resolveAdminHref: (href: string) => string;
};

const AdminUnsavedContext = createContext<AdminUnsavedContextValue | null>(null);

function resolveAdminHref(href: string, adminBasePath: string) {
  if (adminBasePath === "/admin") return href;
  if (href === "/admin") return adminBasePath;
  if (href.startsWith("/admin/")) return `${adminBasePath}${href.slice("/admin".length)}`;
  if (href.startsWith("/admin?")) return `${adminBasePath}${href.slice("/admin".length)}`;
  return href;
}

export function AdminUnsavedChangesProvider({
  adminBasePath,
  children,
}: PropsWithChildren<{ adminBasePath: string }>) {
  const router = useRouter();
  const [dirtyBySource, setDirtyBySource] = useState<DirtyMap>({});
  const [popGuardToken] = useState(() => `jju-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const dirtyLabels = Object.values(dirtyBySource).filter(entry => entry.dirty).map(entry => entry.label);
  const hasUnsavedChanges = dirtyLabels.length > 0;
  const warning = dirtyLabels.length
    ? `You have unsaved changes in ${dirtyLabels.join(", ")}. Leave this page and discard them?`
    : "You have unsaved Workshop changes. Leave this page and discard them?";

  const setUnsaved = useCallback((source: string, dirty: boolean, label = "this Workshop page") => {
    setDirtyBySource(current => {
      if (!dirty) {
        if (!current[source]) return current;
        const next = { ...current };
        delete next[source];
        return next;
      }
      if (current[source]?.dirty && current[source]?.label === label) return current;
      return { ...current, [source]: { dirty: true, label } };
    });
  }, []);

  const confirmNavigation = useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm(warning);
  }, [hasUnsavedChanges, warning]);

  const resolveHref = useCallback((href: string) => resolveAdminHref(href, adminBasePath), [adminBasePath]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const markerKey = "__jjuUnsavedGuard";
    const currentState = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...currentState, [markerKey]: popGuardToken }, "", window.location.href);
    let active = true;
    let allowNextPop = false;
    let pendingBack: number | undefined;

    function guardHistoryTraversal() {
      if (allowNextPop) {
        allowNextPop = false;
        return;
      }
      if (!active) return;
      if (!window.confirm(warning)) {
        const state = history.state && typeof history.state === "object" ? history.state : {};
        history.pushState({ ...state, [markerKey]: popGuardToken }, "", window.location.href);
        return;
      }

      active = false;
      allowNextPop = true;
      pendingBack = window.setTimeout(() => history.back(), 0);
    }

    window.addEventListener("popstate", guardHistoryTraversal);
    return () => {
      window.removeEventListener("popstate", guardHistoryTraversal);
      if (pendingBack !== undefined) window.clearTimeout(pendingBack);
      if (active && history.state?.[markerKey] === popGuardToken) {
        const nextState = { ...history.state };
        delete nextState[markerKey];
        history.replaceState(nextState, "", window.location.href);
      }
    };
  }, [hasUnsavedChanges, popGuardToken, warning]);

  useEffect(() => {
    function guardWorkshopLinks(event: globalThis.MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const rewrittenPath = resolveAdminHref(destination.pathname, adminBasePath);
      const rewritten = `${rewrittenPath}${destination.search}${destination.hash}`;
      const needsRewrite = rewrittenPath !== destination.pathname;
      const isCurrent = rewritten === `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (isCurrent) return;

      if (!confirmNavigation()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (needsRewrite) {
        event.preventDefault();
        event.stopPropagation();
        router.push(rewritten);
      }
    }

    document.addEventListener("click", guardWorkshopLinks, true);
    return () => document.removeEventListener("click", guardWorkshopLinks, true);
  }, [adminBasePath, confirmNavigation, router]);

  const value = useMemo<AdminUnsavedContextValue>(() => ({
    adminBasePath,
    hasUnsavedChanges,
    setUnsaved,
    confirmNavigation,
    resolveAdminHref: resolveHref,
  }), [adminBasePath, confirmNavigation, hasUnsavedChanges, resolveHref, setUnsaved]);

  return <AdminUnsavedContext.Provider value={value}>{children}</AdminUnsavedContext.Provider>;
}

export function useAdminUnsavedChanges() {
  const context = useContext(AdminUnsavedContext);
  if (!context) throw new Error("useAdminUnsavedChanges must be used inside AdminUnsavedChangesProvider.");
  return context;
}

type GuardedAdminLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & LinkProps;

export function GuardedAdminLink({ href, onClick, ...props }: GuardedAdminLinkProps) {
  const { resolveAdminHref } = useAdminUnsavedChanges();
  const resolvedHref = typeof href === "string" ? resolveAdminHref(href) : href;
  return <Link href={resolvedHref} onClick={onClick} {...props} />;
}
