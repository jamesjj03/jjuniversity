export type WorkshopModeId = "books" | "collections" | "print" | "audio" | "review";

export type WorkshopNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  description: string;
};

export type WorkshopMode = WorkshopNavItem & {
  id: WorkshopModeId;
  relatedHrefs: string[];
  subnav: WorkshopNavItem[];
};

export const WORKSHOP_MODES: WorkshopMode[] = [
  {
    id: "books",
    href: "/admin/books",
    label: "Books",
    description: "Write and publish",
    relatedHrefs: ["/admin/books"],
    subnav: [
      { href: "/admin/books", label: "Find a book", shortLabel: "Find", description: "Search or browse the library" },
      { href: "/admin/books/new", label: "New book", shortLabel: "New", description: "Start a hidden draft" },
    ],
  },
  {
    id: "collections",
    href: "/admin/organize",
    label: "Collections",
    description: "Shape the library",
    relatedHrefs: ["/admin/organize", "/admin/topics", "/admin/taxonomy-review"],
    subnav: [
      { href: "/admin/organize", label: "Collections", description: "Drag, remove, and reorder books" },
      { href: "/admin/topics", label: "Topics", description: "Audit topics and descriptions" },
      { href: "/admin/taxonomy-review", label: "Taxonomy", description: "Review structure and edge cases" },
    ],
  },
  {
    id: "print",
    href: "/admin/print",
    label: "Print",
    description: "Build physical editions",
    relatedHrefs: ["/admin/print"],
    subnav: [
      { href: "/admin/print", label: "Print Design Lab", shortLabel: "Design", description: "Build covers, spines, formats, and the series system" },
      { href: "/admin/print/proofs", label: "Proof gallery", shortLabel: "Proofs", description: "Inspect rendered pages" },
    ],
  },
  {
    id: "audio",
    href: "/admin/audio",
    label: "Audio",
    description: "Listen and manage narrators",
    relatedHrefs: ["/admin/audio", "/admin/narrators"],
    subnav: [
      { href: "/admin/audio", label: "Audio QA", shortLabel: "QA", description: "Listen to sealed editions" },
      { href: "/admin/narrators", label: "Narrator Room", shortLabel: "Narrators", description: "Assign, offer, and review work" },
    ],
  },
  {
    id: "review",
    href: "/admin/reviews",
    label: "Review",
    description: "Decisions that need you",
    relatedHrefs: [
      "/admin/reviews",
      "/admin/reading",
      "/admin/manuscript-case",
      "/admin/editorial",
      "/admin/atlas",
      "/admin/arena",
      "/admin/more",
      "/admin/legacy",
    ],
    subnav: [
      { href: "/admin/reviews", label: "Review queue", shortLabel: "Queue", description: "Finite decisions that need your eyes" },
      { href: "/admin/reading", label: "Reading", description: "Signed-in reading activity" },
      { href: "/admin/manuscript-case", label: "Capitalization", shortLabel: "Case", description: "Review capitalization batches" },
      { href: "/admin/editorial", label: "Editorial", description: "Inspect editorial records" },
      { href: "/admin/atlas", label: "Atlas", description: "Review map explanations and JJU place links" },
      { href: "/admin/arena", label: "Arena · local", shortLabel: "Arena", description: "Review local source candidates" },
    ],
  },
];

export const WORKSHOP_TOOLS: WorkshopNavItem[] = [
  { href: "/admin/reading", label: "Reading activity", description: "Signed-in reader analytics" },
  { href: "/admin/legacy?view=site", label: "Homepage editor", description: "Featured and newest books" },
  { href: "/admin/legacy?view=fiber", label: "Fiber editor", description: "Private Fiber configuration" },
  { href: "/admin/editorial", label: "Editorial records", description: "Existing editorial review records" },
  { href: "/admin/atlas", label: "Atlas editorial authority", description: "Explanations and reviewed geographic links" },
  { href: "/admin/arena", label: "Arena · local only", description: "Source and diagram review on this PC" },
  { href: "/admin/legacy", label: "Legacy workspace", description: "Retained tools and compatibility" },
];

export function workshopPathMatches(pathname: string, href: string) {
  const cleanHref = href.split("?")[0];
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

export function workshopModeForPath(pathname: string) {
  return WORKSHOP_MODES.find(mode => mode.relatedHrefs.some(href => workshopPathMatches(pathname, href))) || null;
}

export function canonicalWorkshopPath(pathname: string, adminBasePath: string) {
  if (adminBasePath === "/admin") return pathname;
  if (pathname === adminBasePath) return "/admin";
  if (pathname.startsWith(`${adminBasePath}/`)) return `/admin${pathname.slice(adminBasePath.length)}`;
  return pathname;
}
