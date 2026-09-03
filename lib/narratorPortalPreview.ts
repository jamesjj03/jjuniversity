import "server-only";

import type { NarratorPortalData } from "@/lib/narratorPortal";

const TACOS_SECTIONS = [
  ["section-002", "Everything I Touch Turns to Tacos"],
  ["section-003", "Dedication"],
  ["section-004", "Chapter One - Max Wants a Thing"],
  ["section-005", "Chapter Two - The Taco Truck on the Corner"],
  ["section-006", "Chapter Three - The Woman in the Window"],
  ["section-007", "Chapter Four - Everything I Touch Turns to Tacos"],
  ["section-008", "Chapter Five - The Hunger Games (But It's Just Max)"],
  ["section-009", "Chapter Six - The Talk Before the Taco"],
  ["section-010", "Chapter Seven - I Turned My Mom Into a Taco"],
  ["section-011", "Chapter Eight - Back to the Taco Truck"],
  ["section-012", "Chapter Nine - Feeding the Folks"],
  ["section-013", "Chapter Ten - One Last Taco"],
  ["section-014", "Tips from Max (Just for Kids)"],
  ["section-015", "Acknowledgements"],
  ["section-016", "About the Author"],
  ["section-017", "Copyright"],
] as const;

export function getNarratorPortalPreviewData(): NarratorPortalData {
  return {
    displayName: "Danny Cancino",
    status: "active",
    assignments: [
      {
        id: "preview-danny-tacos",
        editionId: "preview-tacos-edition",
        bookId: "Tacos",
        bookTitle: "Everything I Touch Turns to Tacos",
        bookSlug: "everything-i-touch-turns-to-tacos",
        coverSrc: "/covers-webp/Tacos.webp",
        status: "recording",
        dueAt: "",
        brief: "",
        tracks: TACOS_SECTIONS.map(([sectionKey, title], index) => ({
          id: `preview-tacos-${sectionKey}`,
          position: index + 1,
          sectionKey,
          title,
          required: true,
          readerHref: ["section-004", "section-005", "section-006", "section-007", "section-008", "section-009", "section-010", "section-011", "section-012", "section-013"].includes(sectionKey)
            ? `/books/everything-i-touch-turns-to-tacos/${title
              .normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
              .replace(/&/g, " and ")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}--${sectionKey}`
            : "/books/everything-i-touch-turns-to-tacos",
          readerLinkKind: ["section-004", "section-005", "section-006", "section-007", "section-008", "section-009", "section-010", "section-011", "section-012", "section-013"].includes(sectionKey) ? "section" : "book",
          latestSubmission: null,
        })),
        submissions: [],
      },
    ],
  };
}
