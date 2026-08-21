import type { Metadata } from "next";
import AdminWorkspaceNav from "@/components/AdminWorkspaceNav";
import { AdminUnsavedChangesProvider, GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { getAdminBasePath } from "@/lib/adminPath";
import styles from "./AdminWorkspace.module.css";

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
      <div className={styles.shell}>
        <AdminWorkspaceNav />
        <div className={styles.stage}>
          <header className={styles.mobileHeader}>
            <div>
              <span>JJU</span>
              <strong>Workshop</strong>
            </div>
            <GuardedAdminLink href="/" aria-label="Open the public JJ University site">View site</GuardedAdminLink>
          </header>
          <div id="workshop-content" className={styles.content}>
            {children}
          </div>
        </div>
      </div>
    </AdminUnsavedChangesProvider>
  );
}
