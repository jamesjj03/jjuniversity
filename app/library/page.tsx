import { permanentRedirect } from "next/navigation";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const query = new URLSearchParams();

  Object.entries(incoming).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  });

  permanentRedirect(`/books${query.size ? `?${query.toString()}` : ""}`);
}
