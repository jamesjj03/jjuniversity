import type { Metadata } from "next";
import AccountClient from "@/components/AccountClient";
import { authCallbackMessageFromParams } from "@/lib/authCallbackMessage";
import { safeAuthReturnPath } from "@/lib/authReturnPath";
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
  const requestedReturnPath = Array.isArray(params.next) ? params.next[0] : params.next;
  const returnPath = safeAuthReturnPath(requestedReturnPath, "/account");
  return (
    <AccountClient
      variant="site-v2"
      returnPath={returnPath}
      initialMessage={authCallbackMessageFromParams(params)}
    />
  );
}
