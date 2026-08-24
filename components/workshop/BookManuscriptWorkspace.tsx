"use client";

import { useCallback, useEffect } from "react";
import AdminReaderEditor from "@/components/AdminReaderEditor";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type { WorkshopBook } from "@/lib/workshopBooks";

export default function BookManuscriptWorkspace({ book }: { book: WorkshopBook }) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const sourceKey = `book-manuscript:${book.id}`;

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setUnsaved(sourceKey, dirty, `${book.title} manuscript`);
  }, [book.title, setUnsaved, sourceKey]);

  useEffect(() => () => setUnsaved(sourceKey, false), [setUnsaved, sourceKey]);

  return (
    <AdminReaderEditor
      book={{ id: book.id, title: book.title, coverFile: book.coverFile }}
      onDirtyChange={handleDirtyChange}
      recoveryStorageKey={`jju.workshop.book-manuscript.${encodeURIComponent(book.id)}.v1`}
      showContentMetadata={false}
    />
  );
}
