export type WorkshopRecentItem = {
  href: string;
  label: string;
  description: string;
  kind: "book" | "collection" | "print" | "audio" | "review" | "tool";
  visitedAt: number;
};

export const WORKSHOP_RECENT_KEY = "jju.workshop.recent-work.v1";
export const WORKSHOP_RECENT_EVENT = "jju-workshop-recent-change";
export const WORKSHOP_OPEN_FINDER_EVENT = "jju-workshop-open-finder";

function isSafeWorkshopHref(value: string) {
  try {
    if (!value.startsWith("/") || value.startsWith("//")) return false;
    const base = new URL("https://workshop.invalid/admin");
    const parsed = new URL(value, base);
    return parsed.origin === base.origin
      && (parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/"));
  } catch {
    return false;
  }
}

function recentWorkKey(item: Pick<WorkshopRecentItem, "href" | "kind">) {
  if (item.kind === "book") {
    const bookId = item.href.match(/^\/admin\/books\/([^/?#]+)/)?.[1];
    if (bookId) return `book:${bookId.toLocaleLowerCase()}`;
  }
  return `${item.kind}:${item.href}`;
}

export function readWorkshopRecent(): WorkshopRecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(WORKSHOP_RECENT_KEY) || "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is WorkshopRecentItem => Boolean(
        item
        && typeof item === "object"
        && typeof (item as WorkshopRecentItem).href === "string"
        && isSafeWorkshopHref((item as WorkshopRecentItem).href)
        && typeof (item as WorkshopRecentItem).label === "string"
        && typeof (item as WorkshopRecentItem).visitedAt === "number",
      ))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function rememberWorkshopRecent(item: Omit<WorkshopRecentItem, "visitedAt">) {
  if (typeof window === "undefined") return;
  if (!isSafeWorkshopHref(item.href)) return;
  try {
    const next = [
      { ...item, visitedAt: Date.now() },
      ...readWorkshopRecent().filter(current => recentWorkKey(current) !== recentWorkKey(item)),
    ].slice(0, 8);
    window.localStorage.setItem(WORKSHOP_RECENT_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(WORKSHOP_RECENT_EVENT));
  } catch {
    // Navigation must never depend on local history storage.
  }
}

export function openWorkshopFinder() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKSHOP_OPEN_FINDER_EVENT));
}
