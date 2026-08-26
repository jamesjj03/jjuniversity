import type { Metadata } from "next";
import { AdminUnsavedChangesProvider } from "@/components/AdminUnsavedChanges";
import WorkshopShell from "@/components/workshop/WorkshopShell";
import { getAdminBasePath } from "@/lib/adminPath";

export const metadata: Metadata = {
  title: "JJU Workshop",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const basePath = getAdminBasePath();
  return (
    <AdminUnsavedChangesProvider adminBasePath={basePath}>
      <WorkshopShell>{children}</WorkshopShell>
    </AdminUnsavedChangesProvider>
  );
}
