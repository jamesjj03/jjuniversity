import { redirect } from "next/navigation";
import { getAdminHref } from "@/lib/adminPath";
import { safeBooksReturnHref, type WorkshopSearchParams } from "../../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: WorkshopSearchParams;
};

export default async function BookManuscriptPage({ params, searchParams }: Props) {
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = rawId.trim().toLowerCase();
  const returnHref = safeBooksReturnHref(query.from);
  redirect(getAdminHref(`/admin/books/${encodeURIComponent(id)}?from=${encodeURIComponent(returnHref)}`));
}
