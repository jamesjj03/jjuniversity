import type { Metadata } from "next";
import TaxonomyReviewDesk from "@/components/TaxonomyReviewDesk";
import { getTaxonomyReviewCatalog } from "@/lib/taxonomyReviewCatalog";
import { readTaxonomyReviewDraft } from "@/lib/taxonomyReviewStore";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collection & Taxonomy Desk | JJ University Admin",
  robots: { index: false, follow: false },
};

export default async function TaxonomyReviewPage() {
  const catalog = getTaxonomyReviewCatalog();
  const state = await readTaxonomyReviewDraft(catalog.draft, new Set(catalog.books.map(book => book.id)));

  return (
    <TaxonomyReviewDesk
      books={catalog.books}
      initialDraft={state.draft}
      initialSavedAt={state.savedAt}
      catalogChanged={state.catalogChanged}
      localFileSaveAvailable={process.env.VERCEL !== "1"}
    />
  );
}
