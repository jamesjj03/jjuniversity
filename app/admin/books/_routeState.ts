export type WorkshopSearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export function safeBooksReturnHref(value: string | string[] | undefined) {
  const candidate = firstSearchValue(value);
  if (!candidate) return "/admin/books";

  try {
    const base = new URL("https://workshop.invalid/admin/books");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || parsed.pathname !== "/admin/books") return "/admin/books";
    return `/admin/books${parsed.search}`;
  } catch {
    return "/admin/books";
  }
}

export function catalogSourceLabel(source: "supabase" | "github" | "file") {
  if (source === "supabase") return "the protected catalog database";
  if (source === "github") return "the current GitHub catalog";
  return "the local catalog files";
}
