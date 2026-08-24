import type { Metadata } from "next";
import AdminClient, { type AdminView } from "@/components/AdminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legacy Workspace | JJU Workshop",
  robots: { index: false, follow: false },
};

const LEGACY_VIEWS = new Set<AdminView>(["add", "editor", "paths", "atlas", "site", "fiber"]);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LegacyWorkshopPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const requested = Array.isArray(query.view) ? query.view[0] : query.view;
  const initialView = requested && LEGACY_VIEWS.has(requested as AdminView) ? requested as AdminView : "editor";

  return <AdminClient key={initialView} initialView={initialView} />;
}
