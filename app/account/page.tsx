import AccountClient from "@/components/AccountClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
  description: "Manage JJ University reader account settings.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function AccountPage() {
  return <AccountClient />;
}
