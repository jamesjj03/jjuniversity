"use client";

import { useCallback, useState } from "react";
import BookOverviewEditor from "@/components/workshop/BookOverviewEditor";
import BookWorkspaceHeader from "@/components/workshop/BookWorkspaceHeader";
import type { WorkshopBook } from "@/lib/workshopBooks";

type Props = {
  initialBook: WorkshopBook;
  initialVersion: string;
  returnHref: string;
  supabaseWriteGateUnavailable: boolean;
};

export default function BookOverviewWorkspace({
  initialBook,
  initialVersion,
  returnHref,
  supabaseWriteGateUnavailable,
}: Props) {
  const [headerBook, setHeaderBook] = useState(initialBook);
  const handleSaved = useCallback((savedBook: WorkshopBook) => {
    setHeaderBook(savedBook);
  }, []);

  return (
    <>
      <BookWorkspaceHeader book={headerBook} active="overview" returnHref={returnHref} />
      <BookOverviewEditor
        initialBook={initialBook}
        initialVersion={initialVersion}
        supabaseWriteGateUnavailable={supabaseWriteGateUnavailable}
        onSaved={handleSaved}
      />
    </>
  );
}
