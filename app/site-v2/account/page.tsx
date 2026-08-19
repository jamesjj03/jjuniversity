import type { Metadata } from "next";
import AccountClient from "@/components/AccountClient";
import { authCallbackMessageFromParams } from "@/lib/authCallbackMessage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Account",
  description: "Sign in and manage reading progress across devices.",
  path: "/account",
  noIndex: true,
});

export default async function SiteV2AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AccountClient
      variant="site-v2"
      returnPath="/account"
      initialMessage={authCallbackMessageFromParams(params)}
    />
  );
}
