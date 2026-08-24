import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import styles from "@/app/admin/WorkshopCore.module.css";

type Props = {
  title: string;
  description: string;
  status: string;
  action: string;
  href?: string;
};

function CardContents({ title, description, status, action }: Omit<Props, "href">) {
  return (
    <>
      <span className={styles.capabilityStatus}>{status}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <span className={styles.statusBadge}>{action}</span>
    </>
  );
}

export default function WorkshopHubCard({ href, ...content }: Props) {
  if (!href) {
    return (
      <article className={styles.hubCard}>
        <CardContents {...content} />
      </article>
    );
  }

  return (
    <GuardedAdminLink className={styles.hubCard} href={href} prefetch={false}>
      <CardContents {...content} />
    </GuardedAdminLink>
  );
}
