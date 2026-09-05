import type { Metadata } from "next";
import AtlasEditorialDesk from "@/components/atlas-world/AtlasEditorialDesk";
import {
  readAtlasAnnotationReviewSnapshot,
  readAtlasAnnotationDraftSnapshot,
  readAtlasAssociationReviewSnapshot,
} from "@/lib/atlasEditorialStore";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas Editorial Authority | JJU Workshop",
  robots: { index: false, follow: false },
};

export default async function AtlasEditorialPage() {
  const [drafts, annotations, associations] = await Promise.all([
    readAtlasAnnotationDraftSnapshot(),
    readAtlasAnnotationReviewSnapshot(),
    readAtlasAssociationReviewSnapshot(),
  ]);
  return <AtlasEditorialDesk initialDrafts={drafts} initialAnnotations={annotations} initialAssociations={associations} />;
}
