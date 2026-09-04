"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRIMARY_CATEGORIES, TAG_TO_PRIMARY } from "@/lib/taxonomy";
import AdminReaderEditor from "@/components/AdminReaderEditor";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import CoverImage from "@/components/CoverImage";
import FiberAdminEditor from "@/components/FiberAdminEditor";
import { DEFAULT_FIBER_CONFIG, FiberConfig, normalizeFiberConfig } from "@/lib/fiberConfig";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";

type Book = {
  id: string;
  title: string;
  subtitle?: string;
  creator?: string;
  author?: string;
  series?: string;
  tags: string[];
  description?: string;
  status?: string;
  coverFile?: string;
  bookFile?: string;
  hiddenCategories?: string[];
  hiddenShelves?: string[];
  visibility?: string;
  archive?: boolean;
  category?: string;
  archiveCategory?: string;
};

type PathBook = {
  id: string;
  order: number;
  note: string;
};

type ReadingPath = {
  id: string;
  title: string;
  aliases?: string[];
  kind?: string;
  type: "series" | "degree" | "path" | "tagPath" | "survey" | "deep-dive" | "biographical" | "chronological" | "thematic";
  level: "starter" | "intermediate" | "advanced";
  description: string;
  tags?: string[];
  bookCount?: number;
  books: PathBook[];
  deleted?: boolean;
};

type PathsFile = {
  generated: string;
  generatedAt?: string;
  correctionsAppliedAt?: string;
  counts?: Record<string, unknown>;
  series: ReadingPath[];
  paths: ReadingPath[];
  tagPaths?: ReadingPath[];
  recommendedReading?: ReadingPath[];
};

type SiteConfig = {
  homeCards?: unknown[];
  library: {
    featuredPathIds: string[];
    newestIds: string[];
  };
  fiber: {
    visible: boolean;
  };
  social?: {
    instagramUrl?: string;
  };
};

type BookDraft = {
  title: string;
  id: string;
  creator: string;
  description: string;
  tags: string;
  text: string;
  visibility: "main" | "archive";
  archiveCategory: string;
};

type BookDraftPayload = Partial<BookDraft> & {
  quick?: boolean;
  status?: string;
};

const DEFAULT_SITE: SiteConfig = {
  homeCards: [],
  library: {
    featuredPathIds: [],
    newestIds: [],
  },
  fiber: {
    visible: false,
  },
};

const DEFAULT_BOOK_DRAFT: BookDraft = {
  title: "",
  id: "",
  creator: "James Johnson",
  description: "",
  tags: "",
  text: "",
  visibility: "main",
  archiveCategory: "Unsorted Archive",
};

export type AdminView = "add" | "editor" | "paths" | "site" | "fiber";
type AdminResource = "books" | "paths" | "site" | "fiber";
type LoadStatus = "loading" | "ready" | "error";
type LoadState = Record<AdminResource, { status: LoadStatus; error: string }>;
type ResourceVersions = Record<AdminResource, string>;

const INITIAL_LOAD_STATE: LoadState = {
  books: { status: "loading", error: "" },
  paths: { status: "loading", error: "" },
  site: { status: "loading", error: "" },
  fiber: { status: "loading", error: "" },
};

const ADMIN_VIEWS: Array<{ id: AdminView; label: string; description: string }> = [
  { id: "editor", label: "Books", description: "Metadata, shelves, tags, and content" },
  { id: "paths", label: "Series", description: "Order and book lists" },
  { id: "site", label: "Homepage", description: "Featured and newest" },
  { id: "fiber", label: "Fiber", description: "Private quote page" },
];

function normalize(book: Partial<Book>): Book {
  return {
    ...book,
    id: String(book.id || "").trim().toLowerCase(),
    title: String(book.title || book.id || "Untitled").trim(),
    subtitle: String(book.subtitle || "").trim(),
    creator: String(book.creator || book.author || "").trim(),
    author: String(book.author || book.creator || "").trim(),
    series: String(book.series || "").trim(),
    tags: Array.isArray(book.tags) ? [...new Set(book.tags)].sort() : [],
    description: String(book.description || "").trim(),
    status: String(book.status || "ready").trim().toLowerCase(),
    coverFile: book.coverFile,
    bookFile: book.bookFile,
    hiddenCategories: Array.isArray(book.hiddenCategories) ? book.hiddenCategories.map(String) : [],
    hiddenShelves: Array.isArray(book.hiddenShelves) ? book.hiddenShelves.map(String) : [],
    visibility: book.archive || String(book.visibility || "main").trim().toLowerCase() === "archive" ? "archive" : "main",
    archive: Boolean(book.archive || String(book.visibility || "main").trim().toLowerCase() === "archive"),
    category: String(book.archiveCategory || book.category || "").trim(),
    archiveCategory: String(book.archiveCategory || book.category || "").trim(),
  };
}

function normalizePath(item: Partial<ReadingPath>, fallbackType: ReadingPath["type"] = "thematic"): ReadingPath {
  const title = String(item.title || item.id || "Untitled path").trim();
  const type = item.type || fallbackType;
  return {
    ...item,
    id: String(item.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim().toLowerCase(),
    title,
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String).filter(Boolean) : [],
    kind: String(item.kind || type).trim(),
    type,
    level: item.level || "intermediate",
    description: String(item.description || "").trim(),
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    bookCount: Number(item.bookCount || item.books?.length || 0),
    books: Array.isArray(item.books) ? item.books.map((book, index) => ({
      ...book,
      id: String(book.id || "").trim().toLowerCase(),
      order: Number(book.order || index + 1),
      note: String(book.note || ""),
    })).filter(book => book.id) : [],
    deleted: Boolean(item.deleted),
  };
}

function normalizePathsFile(data: Partial<PathsFile> | null | undefined): PathsFile {
  return {
    ...data,
    generated: String(data?.generated || data?.generatedAt || new Date().toISOString()),
    generatedAt: data?.generatedAt || data?.generated,
    correctionsAppliedAt: data?.correctionsAppliedAt,
    counts: data?.counts,
    series: Array.isArray(data?.series) ? data.series.map(item => normalizePath(item, "series")) : [],
    paths: Array.isArray(data?.paths) ? data.paths.map(item => normalizePath(item)) : [],
    tagPaths: Array.isArray(data?.tagPaths) ? data.tagPaths.map(item => normalizePath(item, "path")) : [],
    recommendedReading: Array.isArray(data?.recommendedReading) ? data.recommendedReading.map(item => normalizePath(item, "path")) : [],
  };
}

function normalizeSiteConfig(data: Partial<SiteConfig> | null | undefined): SiteConfig {
  return {
    homeCards: Array.isArray(data?.homeCards) ? data.homeCards : [],
    library: {
      featuredPathIds: Array.isArray(data?.library?.featuredPathIds) ? data.library.featuredPathIds.map(String).filter(Boolean) : [],
      newestIds: Array.isArray(data?.library?.newestIds) ? data.library.newestIds.map(String).filter(Boolean) : [],
    },
    fiber: {
      visible: Boolean(data?.fiber?.visible),
    },
    social: {
      instagramUrl: typeof data?.social?.instagramUrl === "string" ? data.social.instagramUrl : "",
    },
  };
}

function downloadJson(books: Book[]) {
  const blob = new Blob([JSON.stringify(books, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "books.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function primaryFor(book: Book) {
  const hidden = new Set([...(book.hiddenCategories || []), ...(book.hiddenShelves || [])]);
  const found = new Set<string>();
  book.tags
    .filter(tag => !hidden.has(tag))
    .forEach(tag => (TAG_TO_PRIMARY[tag] || []).forEach(category => found.add(category)));
  return [...found].filter(category => !hidden.has(category));
}

function rawPrimaryFor(book: Book) {
  const found = new Set<string>();
  book.tags.forEach(tag => (TAG_TO_PRIMARY[tag] || []).forEach(category => found.add(category)));
  return [...found].sort();
}

function contentIdFor(book: Book) {
  const fileStem = String(book.bookFile || "").replace(/\.(epub|json)$/i, "");
  return fileStem || book.id;
}

function coverFor(book: Partial<Book> | undefined, fallbackId = "") {
  return coverWebpSrc(book, fallbackId);
}

function legacyCoverFor(book: Partial<Book> | undefined, fallbackId = "") {
  return coverFallbackSrc(book, fallbackId);
}

export default function AdminClient({ initialView = "editor" }: { initialView?: AdminView }) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const [books, setBooks] = useState<Book[]>([]);
  const [pathsFile, setPathsFile] = useState<PathsFile>({ generated: "", series: [], paths: [] });
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE);
  const [fiber, setFiber] = useState<FiberConfig>(DEFAULT_FIBER_CONFIG);
  const [bookDraft, setBookDraft] = useState<BookDraft>(DEFAULT_BOOK_DRAFT);
  const [query, setQuery] = useState("");
  const [pathQuery, setPathQuery] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerTag, setPickerTag] = useState("All");
  const [selectedId, setSelectedId] = useState("");
  const [selectedPathId, setSelectedPathId] = useState("");
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [adminView, setAdminView] = useState<AdminView>(initialView);
  const [activeTag, setActiveTag] = useState("All");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeVisibility, setActiveVisibility] = useState("All");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pathsDirty, setPathsDirty] = useState(false);
  const [siteDirty, setSiteDirty] = useState(false);
  const [fiberDirty, setFiberDirty] = useState(false);
  const [bookDraftDirty, setBookDraftDirty] = useState(false);
  const [manuscriptDirty, setManuscriptDirty] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(INITIAL_LOAD_STATE);
  const [resourceVersions, setResourceVersions] = useState<ResourceVersions>({ books: "", paths: "", site: "", fiber: "" });
  const libraryPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryPickerCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadResource(resource: AdminResource, url: string, apply: (data: unknown) => void) {
      try {
        const response = await fetch(url);
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(data?.error || `${resource} returned ${response.status}.`);
        if (data === null) throw new Error(`${resource} returned an unreadable response.`);
        const version = response.headers.get("etag");
        if (!version) throw new Error(`${resource} returned no editable version. Reloading cannot be made safe.`);
        if (!Array.isArray(data) && typeof data === "object" && typeof data.error === "string" && data.error) {
          throw new Error(data.error);
        }
        if (cancelled) return;
        apply(data);
        setResourceVersions(current => ({ ...current, [resource]: version }));
        setLoadState(current => ({ ...current, [resource]: { status: "ready", error: "" } }));
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : `Could not load ${resource}.`;
        setLoadState(current => ({ ...current, [resource]: { status: "error", error: detail } }));
        setMessage(`Workshop is locked because ${resource} did not load: ${detail}`);
      }
    }

    void loadResource("books", "/api/admin/books", data => {
      const payload = data as { books?: unknown } | unknown[];
      const arr = Array.isArray(payload) ? payload : payload.books;
      if (!Array.isArray(arr) || !arr.length) throw new Error("Books response did not include a nonempty catalog array.");
      const rawIds = arr.map(item => item && typeof item === "object" ? String((item as Partial<Book>).id || "").trim().toLowerCase() : "");
      if (rawIds.some(id => !id) || new Set(rawIds).size !== rawIds.length) throw new Error("Books response has missing or duplicate ids.");
      const normalized = arr.map(item => normalize(item as Partial<Book>));
      setBooks(normalized);
      setSelectedId(normalized[0]?.id || "");
    });

    void loadResource("paths", "/api/admin/paths", data => {
      const raw = data as Partial<PathsFile>;
      if (!data || typeof data !== "object" || !Array.isArray(raw.series) || !Array.isArray(raw.paths)) {
        throw new Error("Paths response did not include the expected configuration.");
      }
      const rawGroups = [...raw.series, ...raw.paths, ...(raw.tagPaths || []), ...(raw.recommendedReading || [])];
      if (!rawGroups.length || rawGroups.some(group => !group?.id || !group?.title || !Array.isArray(group.books) || !group.books.length)) {
        throw new Error("Paths response is empty or contains an invalid group.");
      }
      const normalized = normalizePathsFile(raw);
      setPathsFile(normalized);
      setSelectedPathId(normalized.paths[0]?.id || normalized.tagPaths?.[0]?.id || normalized.recommendedReading?.[0]?.id || "");
    });

    void loadResource("site", "/api/admin/site", data => {
      const raw = data as Partial<SiteConfig>;
      if (!data || typeof data !== "object" || !Array.isArray(raw.homeCards) || !raw.homeCards.length || !raw.library
        || !Array.isArray(raw.library.featuredPathIds) || !Array.isArray(raw.library.newestIds)
        || typeof raw.fiber?.visible !== "boolean") {
        throw new Error("Site response did not include the expected configuration.");
      }
      setSite(normalizeSiteConfig(raw));
    });

    void loadResource("fiber", "/api/admin/fiber", data => {
      const raw = data as Partial<FiberConfig>;
      if (!data || typeof data !== "object" || !raw.theme || !raw.sections || !raw.hero || !raw.contact || !raw.quote
        || !Array.isArray(raw.quote.plans) || !raw.quote.plans.length || !raw.faq || !Array.isArray(raw.faq.items)) {
        throw new Error("Fiber response did not include the expected configuration.");
      }
      setFiber(normalizeFiberConfig(data as FiberConfig));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnsaved("books-workspace", dirty || pathsDirty || siteDirty || fiberDirty);
  }, [dirty, fiberDirty, pathsDirty, setUnsaved, siteDirty]);

  useEffect(() => {
    setUnsaved("book-manuscript", manuscriptDirty);
  }, [manuscriptDirty, setUnsaved]);

  useEffect(() => {
    setUnsaved("new-book-draft", bookDraftDirty);
  }, [bookDraftDirty, setUnsaved]);

  useEffect(() => () => {
    setUnsaved("books-workspace", false);
    setUnsaved("book-manuscript", false);
    setUnsaved("new-book-draft", false);
  }, [setUnsaved]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    books.forEach(book => book.tags.forEach(tag => tags.add(tag)));
    PRIMARY_CATEGORIES.forEach(category => category.tags.forEach(tag => tags.add(tag)));
    return ["All", ...Array.from(tags).sort()];
  }, [books]);

  const categories = useMemo(() => ["All", ...PRIMARY_CATEGORIES.map(category => category.name)], []);
  const archiveCategories = useMemo(() => {
    const defaults = [
      "Personal Memoirs",
      "Work & Sales Memoirs",
      "Fiction & Children's Books",
      "Spiritual & Experimental",
      "Personal Culture & Habits",
      "Old Drafts & Experiments",
      "Unsorted Archive",
    ];
    const existing = books.map(book => book.archiveCategory || book.category).filter(Boolean) as string[];
    return Array.from(new Set([...defaults, ...existing])).sort();
  }, [books]);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return books.filter(book => {
      const primaries = primaryFor(book);
      const haystack = [book.id, book.title, book.series, book.description, ...book.tags, ...primaries].join(" ").toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (activeCategory !== "All" && !primaries.includes(activeCategory)) return false;
      if (activeTag !== "All" && !book.tags.includes(activeTag)) return false;
      if (activeVisibility === "Main" && book.visibility === "archive") return false;
      if (activeVisibility === "Archive" && book.visibility !== "archive") return false;
      return true;
    });
  }, [activeCategory, activeTag, activeVisibility, books, query]);

  const allPathItems = useMemo(() => [
    ...pathsFile.series,
    ...pathsFile.paths,
    ...(pathsFile.tagPaths || []),
    ...(pathsFile.recommendedReading || []),
  ], [pathsFile]);
  const visiblePaths = useMemo(() => {
    const q = pathQuery.toLowerCase().trim();
    return allPathItems.filter(item => {
      if (!q) return true;
      return [item.id, item.title, item.description].join(" ").toLowerCase().includes(q);
    });
  }, [allPathItems, pathQuery]);
  const selected = books.find(book => book.id === selectedId) || visible[0] || books[0];
  const mobileBookOptions = selected && !visible.some(book => book.id === selected.id) ? [selected, ...visible] : visible;
  const selectedPath = allPathItems.find(item => item.id === selectedPathId) || allPathItems[0];
  const loadFailures = (Object.entries(loadState) as Array<[AdminResource, LoadState[AdminResource]]>)
    .filter(([, state]) => state.status === "error");
  const workspaceReady = Object.values(loadState).every(state => state.status === "ready");
  const workspaceLoading = Object.values(loadState).some(state => state.status === "loading");
  const workspaceDirty = dirty || pathsDirty || siteDirty || fiberDirty;
  const stats = {
    total: books.length,
    untitled: books.filter(book => book.title.toLowerCase() === book.id.toLowerCase()).length,
    untagged: books.filter(book => !book.tags.length).length,
    archive: books.filter(book => book.visibility === "archive").length,
    changed: workspaceDirty || manuscriptDirty || bookDraftDirty ? "Yes" : "No",
  };

  const tagGroups = useMemo(() => {
    const usedTags = new Set(allTags.filter(tag => tag !== "All"));
    const groups = PRIMARY_CATEGORIES.map(category => ({
      ...category,
      tags: category.tags.filter(tag => usedTags.has(tag)),
    }));
    const grouped = new Set(groups.flatMap(group => group.tags));
    const otherTags = [...usedTags].filter(tag => !grouped.has(tag)).sort();
    return otherTags.length ? [...groups, { name: "Other", description: "Tags not assigned to a main shelf yet.", tags: otherTags }] : groups;
  }, [allTags]);

  const pickerBooks = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim();
    const inPath = new Set(selectedPath?.books.map(book => book.id) || []);
    return books.filter(book => {
      const haystack = [book.id, book.title, book.series, book.description, ...book.tags].join(" ").toLowerCase();
      if (inPath.has(book.id)) return false;
      if (pickerTag !== "All" && !book.tags.includes(pickerTag)) return false;
      if (q && !haystack.includes(q)) return false;
      return book.status !== "hidden";
    });
  }, [books, pickerQuery, pickerTag, selectedPath]);

  function patchBook(id: string, patch: Partial<Book>) {
    if (!workspaceReady || busy) return;
    setDirty(true);
    setBooks(current => current.map(book => book.id === id ? normalize({ ...book, ...patch }) : book));
  }

  function chooseAdminView(view: AdminView) {
    if (view === "add" && dirty) {
      setMessage("Save the current book metadata before creating another book.");
      return;
    }
    if (view !== "editor" && manuscriptDirty && !window.confirm("This manuscript has unsaved changes. Leave the editor and discard them?")) return;
    closeLibraryPicker(false);
    if (view !== "editor") setManuscriptDirty(false);
    setAdminView(view);
  }

  const closeLibraryPicker = useCallback((returnFocus = true) => {
    setLibraryPickerOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => libraryPickerTriggerRef.current?.focus());
  }, []);

  function openLibraryPicker() {
    setLibraryPickerOpen(true);
  }

  function chooseBook(bookId: string, closePicker = false) {
    if (bookId === selected?.id) {
      if (closePicker) closeLibraryPicker();
      return;
    }
    if (manuscriptDirty && !window.confirm("This manuscript has unsaved changes. Switch books and discard them?")) return;
    setManuscriptDirty(false);
    setSelectedId(bookId);
    if (closePicker) closeLibraryPicker();
  }

  useEffect(() => {
    if (!libraryPickerOpen) return;
    window.requestAnimationFrame(() => libraryPickerCloseRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeLibraryPicker();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeLibraryPicker, libraryPickerOpen]);

  function patchBookDraft(patch: Partial<BookDraft>) {
    if (!workspaceReady || busy) return;
    setBookDraftDirty(true);
    setBookDraft(current => ({ ...current, ...patch }));
  }

  function clearBookDraft() {
    setBookDraft(DEFAULT_BOOK_DRAFT);
    setBookDraftDirty(false);
  }

  function patchFiber(next: FiberConfig) {
    if (!workspaceReady || busy) return;
    setFiberDirty(true);
    setFiber(normalizeFiberConfig(next));
  }

  async function submitBookDraft(draft: BookDraftPayload, successMessage: string) {
    if (!workspaceReady || busy) {
      setMessage("Workshop data must finish loading successfully before creating a book.");
      return;
    }
    if (dirty) {
      setMessage("Save the current book metadata before creating another book. Nothing was created.");
      return;
    }
    setBusy(true);
    setMessage("Creating book draft...");

    try {
      const response = await fetch("/api/admin/book-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": resourceVersions.books },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Book draft creation failed.");
      const nextVersion = response.headers.get("etag");
      if (!nextVersion) throw new Error("Book creation returned no catalog version. Reload before making another change.");
      const nextBooks = (data.books || books).map(normalize);
      setBooks(nextBooks);
      setResourceVersions(current => ({ ...current, books: nextVersion }));
      setSelectedId(String(data.book?.id || ""));
      setQuery(String(data.book?.id || data.book?.title || ""));
      setBookDraft(DEFAULT_BOOK_DRAFT);
      setBookDraftDirty(false);
      setDirty(false);
      setAdminView("editor");
      setMessage(data.note || successMessage || `Created ${data.book?.title || "book draft"}. Opened the content editor.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Book draft creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createBlankBook() {
    if (bookDraftDirty) {
      setMessage("Clear the filled new-book draft before starting a blank book so pasted text is not discarded.");
      return;
    }
    await submitBookDraft({
      quick: true,
      creator: bookDraft.creator || DEFAULT_BOOK_DRAFT.creator,
      visibility: "main",
      status: "hidden",
    }, "Created a hidden blank book. Opened the content editor.");
  }

  async function createBookDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitBookDraft({ ...bookDraft, status: "hidden" }, "Created a hidden book draft. Opened the content editor.");
  }

  function toggleTag(tag: string) {
    if (!selected) return;
    const exists = selected.tags.includes(tag);
    patchBook(selected.id, {
      tags: exists ? selected.tags.filter(item => item !== tag) : [...selected.tags, tag].sort(),
    });
  }

  function toggleHiddenShelf(shelf: string) {
    if (!selected) return;
    const hidden = new Set(selected.hiddenShelves || selected.hiddenCategories || []);
    if (hidden.has(shelf)) hidden.delete(shelf);
    else hidden.add(shelf);
    patchBook(selected.id, { hiddenShelves: [...hidden].sort(), hiddenCategories: [...hidden].filter(item => rawPrimaryFor(selected).includes(item)).sort() });
  }

  function setFeaturedIds(kind: "featuredPathIds" | "newestIds", ids: string[]) {
    setSiteDirty(true);
    setSite(current => ({
      ...current,
      library: {
        ...current.library,
        [kind]: ids,
      },
    }));
  }

  function addFeaturedId(kind: "featuredPathIds" | "newestIds", id: string) {
    if (!id || site.library[kind].includes(id)) return;
    setFeaturedIds(kind, [...site.library[kind], id]);
  }

  function setFiberVisible(visible: boolean) {
    setSiteDirty(true);
    setSite(current => ({
      ...current,
      fiber: {
        ...current.fiber,
        visible,
      },
    }));
  }

  function moveFeaturedId(kind: "featuredPathIds" | "newestIds", index: number, offset: number) {
    const ids = site.library[kind];
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= ids.length) return;
    const next = [...ids];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setFeaturedIds(kind, next);
  }

  function markPathsChanged() {
    setPathsDirty(true);
  }

  function patchPath(id: string, patch: Partial<ReadingPath>) {
    setPathsFile(current => {
      const next = {
        ...current,
        series: current.series.map(item => item.id === id ? normalizePath({ ...item, ...patch }, "series") : item),
        paths: current.paths.map(item => item.id === id ? normalizePath({ ...item, ...patch }) : item),
        tagPaths: (current.tagPaths || []).map(item => item.id === id ? normalizePath({ ...item, ...patch }) : item),
        recommendedReading: (current.recommendedReading || []).map(item => item.id === id ? normalizePath({ ...item, ...patch }) : item),
      };
      markPathsChanged();
      return next;
    });
  }

  function removePaths(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    setPathsFile(current => {
      const next = {
        ...current,
        series: current.series.filter(item => !idSet.has(item.id)),
        paths: current.paths.filter(item => !idSet.has(item.id)),
        tagPaths: (current.tagPaths || []).filter(item => !idSet.has(item.id)),
        recommendedReading: (current.recommendedReading || []).filter(item => !idSet.has(item.id)),
      };
      markPathsChanged();
      return next;
    });
    setSelectedPathIds([]);
    if (idSet.has(selectedPathId)) setSelectedPathId("");
  }

  function hidePaths(ids: string[]) {
    ids.forEach(id => patchPath(id, { deleted: true }));
    setSelectedPathIds([]);
  }

  function togglePathSelection(id: string) {
    setSelectedPathIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function updatePathBooks(pathId: string, books: PathBook[]) {
    patchPath(pathId, { books: books.map((book, index) => ({ ...book, note: String(book.note || ""), order: index + 1 })) });
  }

  function addPathBook(bookId: string) {
    if (!selectedPath) return;
    updatePathBooks(selectedPath.id, [...selectedPath.books, { id: bookId, order: selectedPath.books.length + 1, note: "" }]);
  }

  function removePathBook(pathId: string, index: number) {
    const item = allPathItems.find(pathItem => pathItem.id === pathId);
    if (!item) return;
    updatePathBooks(pathId, item.books.filter((_, bookIndex) => bookIndex !== index));
  }

  function movePathBook(pathId: string, index: number, offset: number) {
    const item = allPathItems.find(pathItem => pathItem.id === pathId);
    if (!item) return;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= item.books.length) return;
    const books = [...item.books];
    [books[index], books[nextIndex]] = [books[nextIndex], books[index]];
    updatePathBooks(pathId, books);
  }

  function movePath(pathId: string, offset: number) {
    setPathsFile(current => {
      const buckets: Array<keyof Pick<PathsFile, "series" | "paths" | "tagPaths" | "recommendedReading">> = ["series", "paths", "tagPaths", "recommendedReading"];
      const bucket = buckets.find(key => (current[key] || []).some(item => item.id === pathId));
      if (!bucket) return current;
      const list = [...(current[bucket] || [])];
      const index = list.findIndex(item => item.id === pathId);
      const visibleIds = visiblePaths
        .filter(item => list.some(pathItem => pathItem.id === item.id))
        .map(item => item.id);
      const visibleIndex = visibleIds.indexOf(pathId);
      const targetId = visibleIds[visibleIndex + offset];
      const nextIndex = targetId ? list.findIndex(item => item.id === targetId) : index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return current;
      const [moved] = list.splice(index, 1);
      list.splice(nextIndex, 0, moved);
      const next = { ...current, [bucket]: list };
      markPathsChanged();
      return next;
    });
  }

  function pathBucketPosition(pathId: string) {
    const buckets: Array<keyof Pick<PathsFile, "series" | "paths" | "tagPaths" | "recommendedReading">> = ["series", "paths", "tagPaths", "recommendedReading"];
    for (const bucket of buckets) {
      const list = pathsFile[bucket] || [];
      const index = list.findIndex(item => item.id === pathId);
      if (index >= 0) {
        const visibleIds = visiblePaths
          .filter(item => list.some(pathItem => pathItem.id === item.id))
          .map(item => item.id);
        const visibleIndex = visibleIds.indexOf(pathId);
        return {
          index,
          length: list.length,
          hasVisiblePrevious: visibleIndex > 0,
          hasVisibleNext: visibleIndex >= 0 && visibleIndex < visibleIds.length - 1,
        };
      }
    }
    return { index: -1, length: 0, hasVisiblePrevious: false, hasVisibleNext: false };
  }

  async function saveAll(exportBooks = false) {
    if (!workspaceReady || busy) {
      setMessage("Save and export stay locked until every Workshop resource loads successfully.");
      return;
    }
    setBusy(true);
    setMessage("Saving admin changes...");
    const saved: string[] = [];

    try {
      if (dirty) {
        const response = await fetch("/api/admin/books", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": resourceVersions.books },
          body: JSON.stringify({ books, message: "Update JJU library metadata" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Book save failed.");
        const nextVersion = response.headers.get("etag");
        if (!nextVersion) throw new Error("Book save returned no version. Reload before saving again.");
        setBooks((data.books || books).map(normalize));
        setResourceVersions(current => ({ ...current, books: nextVersion }));
        setDirty(false);
        if (exportBooks) downloadJson(data.books || books);
        saved.push("books");
      } else if (exportBooks) {
        downloadJson(books);
        saved.push("books export");
      }

      if (pathsDirty) {
        const response = await fetch("/api/admin/paths", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": resourceVersions.paths },
          body: JSON.stringify({ paths: pathsFile, message: "Update JJU reading paths" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Path save failed.");
        const nextVersion = response.headers.get("etag");
        if (!nextVersion) throw new Error("Path save returned no version. Reload before saving again.");
        setPathsFile(normalizePathsFile(data.paths));
        setResourceVersions(current => ({ ...current, paths: nextVersion }));
        setPathsDirty(false);
        saved.push("paths");
      }

      if (siteDirty) {
        const response = await fetch("/api/admin/site", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": resourceVersions.site },
          body: JSON.stringify({ site, message: "Update JJU site settings" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Site settings save failed.");
        const nextVersion = response.headers.get("etag");
        if (!nextVersion) throw new Error("Site save returned no version. Reload before saving again.");
        setSite(normalizeSiteConfig(data.site));
        setResourceVersions(current => ({ ...current, site: nextVersion }));
        setSiteDirty(false);
        saved.push("site");
      }

      if (fiberDirty) {
        const response = await fetch("/api/admin/fiber", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": resourceVersions.fiber },
          body: JSON.stringify({ fiber, message: "Update JJU fiber page settings" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Fiber settings save failed.");
        const nextVersion = response.headers.get("etag");
        if (!nextVersion) throw new Error("Fiber save returned no version. Reload before saving again.");
        setFiber(normalizeFiberConfig(data.fiber));
        setResourceVersions(current => ({ ...current, fiber: nextVersion }));
        setFiberDirty(false);
        saved.push("fiber");
      }

      setMessage(saved.length ? `Saved ${saved.join(", ")}.` : "Nothing changed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className={`page adminPage ${adminView}AdminView`}
      aria-busy={busy || workspaceLoading}
      inert={busy ? true : undefined}
    >
      <section className="adminHero">
        <div>
          <p className="kicker">Library desk</p>
          <h1>Books &amp; publishing</h1>
          <div className="adminPulse" aria-label="Admin snapshot">
            <span><strong>{stats.total}</strong> books</span>
            <span><strong>{stats.changed}</strong> unsaved</span>
          </div>
        </div>
        <div className="adminActions">
          <button className="resetBtn" disabled={busy || !workspaceReady} onClick={() => chooseAdminView(adminView === "add" ? "editor" : "add")}>
            {adminView === "add" ? "Back to Books" : "New Book"}
          </button>
          <button className="formBtn saveEverythingBtn" disabled={busy || !workspaceReady || !workspaceDirty} onClick={() => saveAll(false)}>
            {busy ? "Saving..." : workspaceDirty ? "Save Changes" : "Saved"}
          </button>
          <button className="resetBtn" disabled={busy || !workspaceReady} onClick={() => saveAll(true)}>Export Books</button>
        </div>
      </section>

      {message && <div className="adminNotice">{message}</div>}

      {!workspaceReady && (
        <section className="adminPanel adminLoadGate" role={loadFailures.length ? "alert" : "status"}>
          <p className="kicker">Protected loading gate</p>
          <h2>{loadFailures.length ? "Editing is locked" : "Loading Workshop data"}</h2>
          {loadFailures.length ? (
            <>
              <p>No editor, save, or export control is using fallback data. Reload after the protected resources are available.</p>
              <ul>
                {loadFailures.map(([resource, state]) => <li key={resource}><strong>{resource}</strong>: {state.error}</li>)}
              </ul>
            </>
          ) : (
            <p>Books, series, site settings, and Fiber configuration must all arrive before editing opens.</p>
          )}
        </section>
      )}

      <nav className="adminSectionTabs" aria-label="Admin sections">
        {ADMIN_VIEWS.map(view => (
          <button className={adminView === view.id ? "active" : ""} key={view.id} onClick={() => chooseAdminView(view.id)}>
            <strong>{view.label}</strong>
            <span>{view.description}</span>
          </button>
        ))}
      </nav>

      {workspaceReady && <>

      {adminView === "add" && <section className="adminPanel addBookPanel">
        <div className="pathBuilderTop">
          <div>
            <p className="kicker">New book</p>
            <h2>Start a book without the file circus</h2>
            <p className="adminHelpText">The draft starts hidden, gets its reader file and cover fallback automatically, and opens straight into editing.</p>
          </div>
        </div>

        <section className="newBookLaunch" aria-label="Create a blank book">
          <div>
            <p className="kicker">Fast start</p>
            <h3>Blank book shell</h3>
            <p>No EPUB, no cover conversion, no filename wrangling.</p>
          </div>
            <button className="newBookButton" disabled={busy || bookDraftDirty} onClick={createBlankBook} type="button">
            {busy ? "Creating..." : "New Book"}
          </button>
        </section>

        <form className="addBookForm" onSubmit={createBookDraft}>
          <div className="addBookOptionalHeader">
            <h3>Optional setup</h3>
            <span>Paste text or prefill details when you already have them.</span>
          </div>

          <div className="addBookGrid">
            <label>
              <span>Title</span>
              <input className="input" value={bookDraft.title} onChange={event => patchBookDraft({ title: event.target.value })} placeholder="Auto-created if blank" />
            </label>

            <label>
              <span>Optional ID</span>
              <input className="input" value={bookDraft.id} onChange={event => patchBookDraft({ id: event.target.value })} placeholder="auto-created from title" />
            </label>

            <label>
              <span>Creator</span>
              <input className="input" value={bookDraft.creator} onChange={event => patchBookDraft({ creator: event.target.value })} placeholder="James Johnson" />
            </label>

            <label>
              <span>Tags</span>
              <input className="input" list="addBookTags" value={bookDraft.tags} onChange={event => patchBookDraft({ tags: event.target.value })} placeholder="Science & Mathematics, Philosophy" />
            </label>

            <label>
              <span>Placement</span>
              <select className="select" value={bookDraft.visibility} onChange={event => patchBookDraft({ visibility: event.target.value as BookDraft["visibility"] })}>
                <option value="main">Main library</option>
                <option value="archive">Archive</option>
              </select>
            </label>

            {bookDraft.visibility === "archive" && (
              <label>
                <span>Archive category</span>
                <input className="input" list="archiveCategoryOptions" value={bookDraft.archiveCategory} onChange={event => patchBookDraft({ archiveCategory: event.target.value })} />
              </label>
            )}
          </div>

          <label>
            <span>Description</span>
            <textarea value={bookDraft.description} onChange={event => patchBookDraft({ description: event.target.value })} placeholder="Short library description. You can leave it blank and polish it later." />
          </label>

          <label>
            <span>Draft text</span>
            <textarea
              className="addBookDraftText"
              value={bookDraft.text}
              onChange={event => patchBookDraft({ text: event.target.value })}
              placeholder={"Paste the book or a rough draft here. Headings like Chapter 1 or ## Part One become reader sections. Leave blank to create an empty draft."}
            />
          </label>

          <datalist id="addBookTags">
            {allTags.filter(tag => tag !== "All").map(tag => <option key={tag} value={tag} />)}
          </datalist>
          <datalist id="archiveCategoryOptions">
            {archiveCategories.map(item => <option key={item} value={item} />)}
          </datalist>

          <div className="adminActions">
            <button className="formBtn" disabled={busy} type="submit">{busy ? "Creating..." : "Create From Details"}</button>
            <button className="resetBtn" disabled={busy} type="button" onClick={clearBookDraft}>Clear</button>
          </div>
        </form>
      </section>}

      {adminView === "fiber" && <FiberAdminEditor config={fiber} onChange={patchFiber} />}

      {adminView === "site" && <section className="adminPanel siteSettingsPanel">
        <div className="pathBuilderTop">
          <div>
            <p className="kicker">Site Curation</p>
            <h2>Choose featured paths and newest order</h2>
          </div>
        </div>

        <section className="sitePublishPanel">
          <div>
            <h3>Fiber page</h3>
            <p>Keep this private unless you want the fiber quote page visible in public navigation.</p>
          </div>
          <label className="adminToggle">
            <input
              type="checkbox"
              checked={site.fiber.visible}
              onChange={event => setFiberVisible(event.target.checked)}
            />
            <span>{site.fiber.visible ? "Published" : "Hidden"}</span>
          </label>
        </section>

        <div className="featuredEditorGrid">
          <section>
            <h3>Featured series</h3>
            <select className="select" value="" onChange={event => addFeaturedId("featuredPathIds", event.target.value)}>
              <option value="">Add a series...</option>
              {allPathItems.filter(item => !item.deleted).map(item => (
                <option value={item.id} key={item.id}>{item.title}</option>
              ))}
            </select>
            <div className="pathBookRows">
              {site.library.featuredPathIds.map((id, index) => {
                const item = allPathItems.find(pathItem => pathItem.id === id);
                return (
                  <div className="pathBookRow" key={`path-feature-${id}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{item?.title || id}</strong>
                      <small>{item?.books.length || 0} books</small>
                    </div>
                    <button onClick={() => moveFeaturedId("featuredPathIds", index, -1)} disabled={index === 0}>Up</button>
                    <button onClick={() => moveFeaturedId("featuredPathIds", index, 1)} disabled={index === site.library.featuredPathIds.length - 1}>Down</button>
                    <button onClick={() => setFeaturedIds("featuredPathIds", site.library.featuredPathIds.filter((_, idIndex) => idIndex !== index))}>Remove</button>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3>Newest</h3>
            <p className="adminHelpText">This controls the Newest sort in the library. You can manage it here, or drop an ordered ID array into <code>public/newest.json</code> when this list is empty.</p>
            <select className="select" value="" onChange={event => addFeaturedId("newestIds", event.target.value)}>
              <option value="">Add a book...</option>
              {books.filter(book => book.status !== "hidden").map(book => (
                <option value={book.id} key={book.id}>{book.title || book.id}</option>
              ))}
            </select>
            <div className="pathBookRows">
              {site.library.newestIds.map((id, index) => {
                const item = books.find(book => book.id === id);
                return (
                  <div className="pathBookRow" key={`newest-${id}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{item?.title || id}</strong>
                      <small>{id}</small>
                    </div>
                    <button onClick={() => moveFeaturedId("newestIds", index, -1)} disabled={index === 0}>Up</button>
                    <button onClick={() => moveFeaturedId("newestIds", index, 1)} disabled={index === site.library.newestIds.length - 1}>Down</button>
                    <button onClick={() => setFeaturedIds("newestIds", site.library.newestIds.filter((_, idIndex) => idIndex !== index))}>Remove</button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </section>}

      {adminView === "paths" && <section className="adminPanel pathBuilderPanel">
        <div className="pathBuilderTop">
          <div>
            <p className="kicker">Series Builder</p>
            <h2>Edit reading series</h2>
          </div>
          <div className="adminActions">
            <button className="resetBtn" disabled={!selectedPath} onClick={() => setBookPickerOpen(true)}>Add Books</button>
            <button className="resetBtn" disabled={!visiblePaths.length} onClick={() => setSelectedPathIds(visiblePaths.map(item => item.id))}>Select Visible</button>
            <button className="resetBtn" disabled={!allPathItems.length} onClick={() => setSelectedPathIds(allPathItems.filter(item => item.kind === "tagPath" || item.type === "tagPath").map(item => item.id))}>Select Tag Routes</button>
            <button className="formBtn" disabled={!selectedPathIds.length} onClick={() => hidePaths(selectedPathIds)}>Hide Selected</button>
            <button className="formBtn" disabled={!selectedPathIds.length} onClick={() => removePaths(selectedPathIds)}>Delete Selected</button>
          </div>
        </div>

        <div className="pathPromptGrid">
          <label>
            <span>Find a series</span>
            <input className="input" value={pathQuery} onChange={event => setPathQuery(event.target.value)} placeholder="Search series title or description..." />
          </label>
        </div>

        <div className="pathManagerGrid">
          <aside className="pathList">
            {visiblePaths.map(item => (
              (() => {
                const position = pathBucketPosition(item.id);
                return (
                  <div className={item.id === selectedPath?.id ? "active pathListRow" : "pathListRow"} key={item.id}>
                    <input type="checkbox" checked={selectedPathIds.includes(item.id)} onChange={() => togglePathSelection(item.id)} />
                    <button onClick={() => setSelectedPathId(item.id)}>
                      <strong>{item.title}</strong>
                      <span>{item.books.length} books</span>
                    </button>
                    <button className="pathMoveBtn" onClick={() => movePath(item.id, -1)} disabled={!position.hasVisiblePrevious}>Up</button>
                    <button className="pathMoveBtn" onClick={() => movePath(item.id, 1)} disabled={!position.hasVisibleNext}>Down</button>
                  </div>
                );
              })()
            ))}
          </aside>

          {selectedPath ? (
            <section className="pathEditor">
              <label>
                <span>Series title</span>
                <input className="input" value={selectedPath.title} onChange={event => patchPath(selectedPath.id, { title: event.target.value })} />
              </label>

              <label>
                <span>Description</span>
                <textarea value={selectedPath.description} onChange={event => patchPath(selectedPath.id, { description: event.target.value })} />
              </label>

              <div className="adminActions pathEditorActions">
                <button className="resetBtn" onClick={() => setBookPickerOpen(true)}>Add Books</button>
                <button className="formBtn" onClick={() => patchPath(selectedPath.id, { deleted: !selectedPath.deleted })}>{selectedPath.deleted ? "Make Visible" : "Hide Series"}</button>
              </div>

              <div className="pathBookRows">
                {selectedPath.books.map((pathBook, index) => {
                  const book = books.find(item => item.id === pathBook.id);
                  return (
                    <div className="pathBookRow" key={`${selectedPath.id}-${pathBook.id}-${index}`}>
                      <span>{index + 1}</span>
                      <CoverImage src={coverFor(book, pathBook.id)} fallbackSrc={legacyCoverFor(book, pathBook.id)} alt="" width={52} height={78} sizes="52px" />
                      <div>
                        <strong>{book?.title || pathBook.id}</strong>
                        <small>{book?.tags.slice(0, 4).join(" / ") || pathBook.id}</small>
                      </div>
                      <button onClick={() => movePathBook(selectedPath.id, index, -1)} disabled={index === 0}>Up</button>
                      <button onClick={() => movePathBook(selectedPath.id, index, 1)} disabled={index === selectedPath.books.length - 1}>Down</button>
                      <button onClick={() => removePathBook(selectedPath.id, index)}>Remove</button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <div className="emptyPathState">No series yet.</div>
          )}
        </div>
      </section>}

      {bookPickerOpen && selectedPath && (
        <div className="bookPickerOverlay" role="dialog" aria-modal="true">
          <section className="bookPickerModal">
            <div className="bookPickerHeader">
              <div>
                <p className="kicker">Add to series</p>
                <h2>{selectedPath.title}</h2>
              </div>
              <button className="resetBtn" onClick={() => setBookPickerOpen(false)}>Close</button>
            </div>
            <div className="bookPickerTools">
              <label>
                <span>Search books</span>
                <input className="input" value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} placeholder="Title, tag, description..." />
              </label>
              <label>
                <span>Tag</span>
                <select className="select" value={pickerTag} onChange={event => setPickerTag(event.target.value)}>
                  {allTags.map(tag => <option key={tag}>{tag}</option>)}
                </select>
              </label>
            </div>
            <div className="bookPickerGrid">
              {pickerBooks.map(book => (
                <button key={book.id} onClick={() => addPathBook(book.id)}>
                  <CoverImage src={coverFor(book)} fallbackSrc={legacyCoverFor(book)} alt="" width={58} height={87} sizes="58px" />
                  <span>
                    <strong>{book.title}</strong>
                    <small>{book.tags.slice(0, 4).join(" / ") || book.id}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {adminView === "editor" && <section className="adminWorkbench">
        <label>
          <span>Find a book</span>
          <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, tag, description..." />
        </label>
        <label>
          <span>Main shelf</span>
          <select className="select" value={activeCategory} onChange={event => { setActiveCategory(event.target.value); setActiveTag("All"); }}>
            {categories.map(category => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label>
          <span>Filter tag</span>
          <select className="select" value={activeTag} onChange={event => setActiveTag(event.target.value)}>
            {allTags.map(tag => <option key={tag}>{tag}</option>)}
          </select>
        </label>
        <label>
          <span>Placement</span>
          <select className="select" value={activeVisibility} onChange={event => setActiveVisibility(event.target.value)}>
            <option>All</option>
            <option>Main</option>
            <option>Archive</option>
          </select>
        </label>
        <button
          ref={libraryPickerTriggerRef}
          className="adminMobilePickerButton"
          type="button"
          aria-expanded={libraryPickerOpen}
          aria-controls="admin-library-picker"
          onClick={openLibraryPicker}
        >
          Browse {visible.length} {visible.length === 1 ? "book" : "books"}
        </button>
      </section>}

      {adminView === "editor" && <section className="adminGrid">
        <aside
          id="admin-library-picker"
          className={libraryPickerOpen ? "adminBookCards adminBookCardsMobileOpen" : "adminBookCards"}
          role={libraryPickerOpen ? "dialog" : undefined}
          aria-modal={libraryPickerOpen ? "true" : undefined}
          aria-labelledby={libraryPickerOpen ? "admin-library-picker-title" : undefined}
        >
          <div className="adminMobilePickerHeader">
            <strong id="admin-library-picker-title">Choose a book</strong>
            <button ref={libraryPickerCloseRef} className="resetBtn" type="button" onClick={() => closeLibraryPicker()}>Done</button>
          </div>
          {visible.map(book => (
            <button className={book.id === selected?.id ? "active adminBookCard" : "adminBookCard"} key={book.id} onClick={() => chooseBook(book.id, true)}>
              <CoverImage src={coverFor(book)} fallbackSrc={legacyCoverFor(book)} alt="" width={58} height={87} sizes="58px" />
              <span>
                <strong>{book.title}</strong>
                <small>{book.visibility === "archive" ? `ARCHIVE / ${book.archiveCategory || book.category || "Uncategorized"}` : `MAIN / ${book.tags.slice(0, 3).join(" / ") || "No tags yet"}`}</small>
              </span>
            </button>
          ))}
        </aside>

        {selected && (
          <div className="adminBookWorkspace">
          <label className="adminMobileBookSelect">
            <span>Editing</span>
            <select className="select" value={selected.id} onChange={event => chooseBook(event.target.value)}>
              {mobileBookOptions.map(book => <option key={book.id} value={book.id}>{book.title}{visible.some(item => item.id === book.id) ? "" : " (current; filtered out)"}</option>)}
            </select>
          </label>
          <section className="adminPanel editorPanel">
            <div className="editorTop">
              <CoverImage src={coverFor(selected)} fallbackSrc={legacyCoverFor(selected)} alt={selected.title} width={120} height={180} sizes="120px" />
              <div>
                <p className="kicker">{selected.id}</p>
                <h2>{selected.title}</h2>
                <div className="adminActions miniActions">
                  <button className={selected.visibility === "archive" ? "resetBtn" : "formBtn archiveMoveBtn"} onClick={() => patchBook(selected.id, { visibility: selected.visibility === "archive" ? "main" : "archive", archive: selected.visibility !== "archive" })}>{selected.visibility === "archive" ? "Restore to Main" : "Move to Archive"}</button>
                </div>
              </div>
            </div>

            <section className={`archiveStatusPanel ${selected.visibility === "archive" ? "isArchive" : "isMain"}`}>
              <label className="archiveQuickToggle">
                <input
                  type="checkbox"
                  checked={selected.visibility === "archive"}
                  onChange={event => patchBook(selected.id, {
                    visibility: event.target.checked ? "archive" : "main",
                    archive: event.target.checked,
                    archiveCategory: event.target.checked ? (selected.archiveCategory || selected.category || "Unsorted Archive") : selected.archiveCategory,
                    category: event.target.checked ? (selected.archiveCategory || selected.category || "Unsorted Archive") : selected.category,
                  })}
                />
                <span>Archive book</span>
              </label>
              <span>{selected.visibility === "archive" ? "Hidden from the main library. Shows on the Archive page." : "Shows in the main library. Hidden from the Archive page."}</span>
            </section>

            <section className="adminFileInspector">
              <div>
                <span>Book ID</span>
                <code>{selected.id}</code>
              </div>
              <div>
                <span>Content JSON</span>
                <code>{contentIdFor(selected)}.json</code>
              </div>
              <div>
                <span>Source file</span>
                <code>{selected.bookFile || "none"}</code>
              </div>
              <div>
                <span>Cover ID</span>
                <code>{selected.coverFile || `${contentIdFor(selected)}.jpg`}</code>
              </div>
            </section>

              <label>
                <span>Title</span>
                <input className="input" value={selected.title} onChange={event => patchBook(selected.id, { title: event.target.value })} />
              </label>

              <div className="twoInputs">
                <label>
                  <span>Subtitle</span>
                  <input className="input" value={selected.subtitle || ""} onChange={event => patchBook(selected.id, { subtitle: event.target.value })} />
                </label>
                <label>
                  <span>Creator</span>
                  <input className="input" value={selected.creator || selected.author || ""} onChange={event => patchBook(selected.id, { creator: event.target.value, author: event.target.value })} />
                </label>
                <label>
                  <span>Series</span>
                  <input className="input" value={selected.series || ""} onChange={event => patchBook(selected.id, { series: event.target.value })} />
                </label>
              </div>

              <label>
                <span>Description</span>
                <textarea value={selected.description || ""} onChange={event => patchBook(selected.id, { description: event.target.value })} />
              </label>

              <div className="twoInputs">
                <label>
                  <span>Cover path</span>
                  <input className="input" value={selected.coverFile || ""} onChange={event => patchBook(selected.id, { coverFile: event.target.value })} placeholder={`${contentIdFor(selected)}.jpg`} />
                </label>
                <label>
                  <span>Optional source file</span>
                  <input className="input" value={selected.bookFile || ""} onChange={event => patchBook(selected.id, { bookFile: event.target.value })} placeholder="Leave blank for admin-created books" />
                </label>
              </div>

              <div className="twoInputs">
                <label>
                  <span>Placement</span>
                  <select className="select" value={selected.visibility || "main"} onChange={event => patchBook(selected.id, { visibility: event.target.value, archive: event.target.value === "archive" })}>
                    <option value="main">main</option>
                    <option value="archive">archive</option>
                  </select>
                </label>
                {selected.visibility === "archive" && (
                  <label>
                    <span>Archive category</span>
                    <input className="input" list="archiveCategoryOptions" value={selected.archiveCategory || selected.category || ""} onChange={event => patchBook(selected.id, { archiveCategory: event.target.value, category: event.target.value })} placeholder="Personal Memoirs, Fiction & Children's Books..." />
                  </label>
                )}
                <label>
                  <span>Status</span>
                  <select className="select" value={selected.status || "ready"} onChange={event => patchBook(selected.id, { status: event.target.value })}>
                    <option>ready</option>
                    <option>coming-soon</option>
                    <option>unavailable</option>
                    <option>hidden</option>
                    <option>needs-review</option>
                  </select>
                </label>
              </div>

              <datalist id="archiveCategoryOptions">
                {archiveCategories.map(item => <option key={item} value={item} />)}
              </datalist>

            <section className="categoryVisibilityPanel">
              <h3>Shelf visibility</h3>
              <p>These are the shelves this book appears in from its tags. Turn off any layer where it does not belong.</p>
              <div className="adminChecks">
                {rawPrimaryFor(selected).map(category => (
                  <label key={`main-${category}`}>
                    <input type="checkbox" checked={!Boolean([...(selected.hiddenCategories || []), ...(selected.hiddenShelves || [])].includes(category))} onChange={() => toggleHiddenShelf(category)} />
                    Main: {category}
                  </label>
                ))}
                {selected.tags.map(tag => (
                  <label key={`tag-${tag}`}>
                    <input type="checkbox" checked={!Boolean(selected.hiddenShelves?.includes(tag))} onChange={() => toggleHiddenShelf(tag)} />
                    Tag: {tag}
                  </label>
                ))}
              </div>
            </section>

            <div className="selectedAdminTags">
              {selected.tags.map(tag => <button key={tag} onClick={() => toggleTag(tag)}>{tag} x</button>)}
            </div>

            <div className="tagGroupGrid">
              {tagGroups.map(group => (
                <section className="tagGroupCard" key={group.name}>
                  <div>
                    <h3>{group.name}</h3>
                    <p>{group.description}</p>
                  </div>
                  <div className="adminTagBank">
                    {group.tags.map(tag => (
                      <button className={selected.tags.includes(tag) ? "active" : ""} key={tag} onClick={() => toggleTag(tag)}>{tag}</button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
          <AdminReaderEditor book={selected} onDirtyChange={setManuscriptDirty} />
          </div>
        )}
      </section>}
      </>}

      {workspaceReady && (workspaceDirty || manuscriptDirty) && (
        <div className="adminMobileSaveDock" role="status" aria-live="polite">
          <span>{manuscriptDirty ? "Manuscript has its own save" : "Workspace changes waiting"}</span>
          <div className="adminMobileSaveActions">
            {workspaceDirty && <button className="formBtn" disabled={busy} onClick={() => saveAll(false)}>
              {busy ? "Saving..." : "Save workspace"}
            </button>}
            {manuscriptDirty && <button className="formBtn" disabled={busy} onClick={() => document.getElementById("admin-manuscript-save")?.click()}>
              Save manuscript
            </button>}
          </div>
        </div>
      )}
    </main>
  );
}
