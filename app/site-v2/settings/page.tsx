import type { Metadata } from "next";
import SiteV2SettingsClient from "@/components/site-v2/SiteV2SettingsClient";
import { getPublicBooksLive } from "@/lib/publishing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Settings",
  description: "Change site and reader settings.",
  path: "/settings",
  noIndex: true,
});

export default async function SiteV2SettingsPage() {
  const books = await getPublicBooksLive();
  const bookIdentityMap = Object.fromEntries(
    books.flatMap(book => (
      [...new Set([book.id, book.slug, ...book.slugAliases])]
        .flatMap(identity => [[identity, book.id], [identity.toLowerCase(), book.id]])
    )),
  );

  return (
    <SiteV2SettingsClient
      bookIdentityMap={bookIdentityMap}
      validBookIds={books.map(book => book.id)}
    />
  );
}
