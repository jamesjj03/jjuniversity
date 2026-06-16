import SettingsClient from "@/components/SettingsClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reader Settings",
  description: "Manage JJ University reader preferences.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function SettingsPage() {
  return <SettingsClient />;
}
