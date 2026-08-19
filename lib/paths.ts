export type Book = {
  id: string;
  title?: string;
  series?: string;
  tags?: string[];
  description?: string;
  status?: string;
  coverFile?: string;
};

export type PathBook = {
  id: string;
  order: number;
  note: string;
};

export type ReadingPath = {
  id: string;
  title: string;
  aliases?: string[];
  kind?: string;
  type?: "series" | "degree" | "path" | "tagPath" | "survey" | "deep-dive" | "biographical" | "chronological" | "thematic";
  level: "starter" | "intermediate" | "advanced";
  description: string;
  tags?: string[];
  bookCount?: number;
  books: PathBook[];
  deleted?: boolean;
};

export type PathsFile = {
  generated?: string;
  generatedAt?: string;
  correctionsAppliedAt?: string;
  counts?: Record<string, unknown>;
  series: ReadingPath[];
  paths: ReadingPath[];
  tagPaths?: ReadingPath[];
  recommendedReading?: ReadingPath[];
};

const PATH_BLUEPRINTS = [
  { id: "power-systems", title: "Power, Control, and the Machine", type: "thematic", level: "starter", tags: ["Propaganda & Social Control", "Government & Politics", "Authoritarianism & Dictatorship", "Capitalism & Corporations"] },
  { id: "american-engine", title: "The American Engine", type: "chronological", level: "starter", tags: ["American History", "American Politics", "American Presidents", "Civil Rights & Social Justice"] },
  { id: "belief-map", title: "What Humans Believe", type: "survey", level: "starter", tags: ["Religion & Spirituality", "World Religions", "Christianity", "Islam", "Buddhism"] },
  { id: "eastern-awakening", title: "Eastern Awakening", type: "deep-dive", level: "intermediate", tags: ["Eastern Philosophy & Religion", "Buddhism", "Spirituality & Mysticism", "Philosophy"] },
  { id: "addiction-loop", title: "The Addiction Loop", type: "deep-dive", level: "starter", tags: ["Addiction & Substance Use", "Consumer Culture", "Psychology & Human Behavior", "Cognitive Science & Neuroscience"] },
  { id: "corporate-creatures", title: "Corporate Creatures", type: "thematic", level: "intermediate", tags: ["Capitalism & Corporations", "Business & Economics", "Consumer Culture", "Political Economy"] },
  { id: "science-foundations", title: "Science Foundations", type: "survey", level: "starter", tags: ["Science & Mathematics", "Science History", "Biology & Medicine", "Physics & Cosmology"] },
  { id: "mind-behavior", title: "Mind, Behavior, and Self-Deception", type: "deep-dive", level: "intermediate", tags: ["Psychology & Human Behavior", "Cognitive Science & Neuroscience", "Philosophy", "Propaganda & Social Control"] },
  { id: "ancient-worlds", title: "Ancient Worlds", type: "chronological", level: "starter", tags: ["Ancient Civilizations", "Ancient Greece", "Ancient Rome", "Mythology & Ancient Beliefs"] },
  { id: "empire-colony", title: "Empire, Borders, and Blood", type: "chronological", level: "advanced", tags: ["Colonialism & Empire", "European History", "African History", "Middle Eastern History"] },
  { id: "war-state", title: "War and the State", type: "chronological", level: "intermediate", tags: ["War & Conflict", "Military History", "20th Century", "Cold War"] },
  { id: "tech-control", title: "Technology Ate the World", type: "thematic", level: "starter", tags: ["Digital Culture & Technology", "Technology & Innovation", "Consumer Culture", "Propaganda & Social Control"] },
  { id: "conspiracy-intelligence", title: "Secrets, Coups, and Cover-Ups", type: "deep-dive", level: "advanced", tags: ["Conspiracy & Cover-ups", "Espionage & Intelligence", "Cold War", "Government & Politics"] },
  { id: "revolution-social-change", title: "Revolution and Social Change", type: "thematic", level: "intermediate", tags: ["Revolution & Social Change", "Social Movements", "Civil Rights & Social Justice", "Political Theory"] },
  { id: "philosophy-shelf", title: "Philosophy Without the Dust", type: "survey", level: "starter", tags: ["Philosophy", "Political Theory", "Cognitive Science & Neuroscience", "Science History"] },
  { id: "food-body", title: "Food, Body, and Modern Life", type: "thematic", level: "starter", tags: ["Food & Culture", "Biology & Medicine", "Consumer Culture", "Addiction & Substance Use"] },
  { id: "medicine-body", title: "Bodies, Disease, and Medicine", type: "deep-dive", level: "intermediate", tags: ["Biology & Medicine", "Science History", "Business & Economics", "Psychology & Human Behavior"] },
  { id: "culture-machine", title: "The Culture Machine", type: "thematic", level: "starter", tags: ["Cultural History", "Art & Music History", "Digital Culture & Technology", "Consumer Culture"] },
  { id: "cults-extremism", title: "Cults, Extremism, and Belonging", type: "deep-dive", level: "advanced", tags: ["Cults & Extremism", "Psychology & Human Behavior", "Religion & Spirituality", "Propaganda & Social Control"] },
  { id: "middle-east", title: "Middle East: Faith, Empire, Conflict", type: "chronological", level: "advanced", tags: ["Middle Eastern History", "Islam", "War & Conflict", "Colonialism & Empire"] },
  { id: "presidents-power", title: "Presidents and Power", type: "biographical", level: "intermediate", tags: ["American Presidents", "Biography", "American Politics", "Government & Politics"] },
  { id: "dictators", title: "How Dictators Happen", type: "biographical", level: "advanced", tags: ["Authoritarianism & Dictatorship", "Biography", "20th Century", "Propaganda & Social Control"] },
] as const;

export function slug(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeBook(book: Book): Book {
  return {
    ...book,
    id: String(book.id || "").trim().toLowerCase(),
    title: String(book.title || book.id || "Untitled").trim(),
    series: String(book.series || "").trim(),
    tags: Array.isArray(book.tags) ? book.tags.map(String).filter(Boolean) : [],
    description: String(book.description || "").trim(),
    status: String(book.status || "ready").trim().toLowerCase(),
  };
}

function scoreBook(book: Book, tags: readonly string[]) {
  const bookTags = new Set(book.tags || []);
  let score = tags.reduce((sum, tag) => sum + (bookTags.has(tag) ? 3 : 0), 0);
  if (book.description) score += 0.4;
  return score;
}

function noteFor(pathTitle: string, book: Book, index: number) {
  if (index === 0) return `Opens ${pathTitle} with ${book.title || book.id}, giving the path its first clear anchor.`;
  if (index < 3) return `Adds ${book.title || book.id} as an early building block before the path gets heavier.`;
  return `Deepens the thread with ${book.title || book.id}, connecting the idea to a wider part of JJ University.`;
}

function booksForTags(books: Book[], tags: readonly string[], title: string, size = 8): PathBook[] {
  return books
    .filter(book => book.status !== "hidden" && book.status !== "unavailable")
    .map(book => ({ book, score: scoreBook(book, tags) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.book.title || a.book.id).localeCompare(b.book.title || b.book.id))
    .slice(0, size)
    .map((item, index) => ({ id: item.book.id, order: index + 1, note: noteFor(title, item.book, index) }));
}

function buildSeries(books: Book[]): ReadingPath[] {
  const actualSeries = new Map<string, Book[]>();
  books.forEach(book => {
    if (!book.series) return;
    actualSeries.set(book.series, [...(actualSeries.get(book.series) || []), book]);
  });

  const fromMetadata = [...actualSeries.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([name, items]) => ({
      id: slug(name),
      title: name,
      type: "series" as const,
      level: "intermediate" as const,
      description: `A connected JJ University sequence around ${name}.`,
      books: items.slice(0, 14).map((book, index) => ({ id: book.id, order: index + 1, note: noteFor(name, book, index) })),
    }));

  const inferred = [
    { id: "actually-says", title: "What It Actually Says", tags: ["Religion & Spirituality", "World Religions"], match: /actually says/i },
    { id: "101-foundations", title: "101 Foundations", tags: ["Science & Mathematics", "Science History"], match: /\b101\b/i },
    { id: "american-presidents", title: "American Presidents", tags: ["American Presidents", "Biography"], match: /president|washington|lincoln|roosevelt|reagan|kennedy|nixon/i },
    { id: "ancient-rulers", title: "Ancient Rulers and Founders", tags: ["Ancient Civilizations", "Biography"], match: /caesar|alexander|cyrus|sargon|ramses|charlemagne/i },
    { id: "tech-giants", title: "Tech Giants and Platform Power", tags: ["Digital Culture & Technology", "Capitalism & Corporations"], match: /bezos|zuck|tesla|ai|tiktok|web/i },
  ].map(group => {
    const direct = books.filter(book => group.match.test(`${book.id} ${book.title || ""}`));
    const picked = direct.length >= 2 ? direct : booksForTags(books, group.tags, group.title, 8).map(item => books.find(book => book.id === item.id)).filter(Boolean) as Book[];
    return {
      id: group.id,
      title: group.title,
      type: "series" as const,
      level: "intermediate" as const,
      description: `A generated series for books that clearly orbit ${group.title.toLowerCase()}.`,
      books: picked.slice(0, 10).map((book, index) => ({ id: book.id, order: index + 1, note: noteFor(group.title, book, index) })),
    };
  }).filter(item => item.books.length >= 2);

  const seen = new Set<string>();
  return [...fromMetadata, ...inferred].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function generateFallbackPaths(rawBooks: Book[], targetCount = 24): PathsFile {
  const books = rawBooks.map(normalizeBook).filter(book => book.id);
  const paths = PATH_BLUEPRINTS
    .map(blueprint => ({
      id: blueprint.id,
      title: blueprint.title,
      type: blueprint.type,
      level: blueprint.level,
      description: `${blueprint.title} is a ${blueprint.level} ${blueprint.type} path through ${blueprint.tags.slice(0, 3).join(", ")}.`,
      books: booksForTags(books, blueprint.tags, blueprint.title, blueprint.level === "advanced" ? 10 : 8),
    }))
    .filter(path => path.books.length >= 4)
    .slice(0, Math.max(20, targetCount));

  return {
    generated: new Date().toISOString(),
    series: buildSeries(books),
    paths,
  };
}

export function cleanPathsFile(value: unknown): PathsFile {
  const data = (value && typeof value === "object" ? value : {}) as Partial<PathsFile>;
  const cleanCollection = (items: unknown, forceType?: "series") => Array.isArray(items) ? items.map((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<ReadingPath> : {};
    const title = String(record.title || `Untitled ${forceType || "Path"} ${index + 1}`).trim();
    const type = forceType || (["degree", "path", "survey", "deep-dive", "biographical", "chronological", "thematic"].includes(String(record.type)) ? record.type : "thematic") as ReadingPath["type"];
    const level = ["starter", "intermediate", "advanced"].includes(String(record.level)) ? record.level as ReadingPath["level"] : "intermediate";
    return {
      id: String(record.id || slug(title) || `${forceType || "path"}-${index + 1}`).trim().toLowerCase(),
      title,
      aliases: Array.isArray(record.aliases) ? record.aliases.map(item => slug(String(item))).filter(Boolean) : [],
      kind: String(record.kind || forceType || type).trim(),
      type,
      level,
      description: String(record.description || "").trim(),
      tags: Array.isArray(record.tags) ? record.tags.map(String).filter(Boolean) : [],
      bookCount: Number(record.bookCount || (Array.isArray(record.books) ? record.books.length : 0)),
      books: Array.isArray(record.books) ? record.books.map((book, bookIndex) => {
        const bookRecord = book && typeof book === "object" ? book as Partial<PathBook> : {};
        return {
          id: String(bookRecord.id || "").trim().toLowerCase(),
          order: Number(bookRecord.order || bookIndex + 1),
          note: "",
        };
      }).filter(book => book.id) : [],
      deleted: Boolean(record.deleted),
    };
  }).filter(item => item.id && item.books.length) : [];

  return {
    generated: String(data.generated || data.generatedAt || new Date().toISOString()),
    generatedAt: String(data.generatedAt || data.generated || new Date().toISOString()),
    correctionsAppliedAt: data.correctionsAppliedAt ? String(data.correctionsAppliedAt) : undefined,
    counts: data.counts && typeof data.counts === "object" ? data.counts as Record<string, unknown> : undefined,
    series: cleanCollection(data.series, "series"),
    paths: cleanCollection(data.paths),
    tagPaths: cleanCollection(data.tagPaths),
    recommendedReading: cleanCollection(data.recommendedReading),
  };
}
