import type { PublishedBook } from "@/lib/publishing";
import {
  SITE_V2_SHELF_IDS_BY_BOOK,
  siteV2TopicsForBook,
  type SiteV2ShelfId,
} from "@/lib/siteV2Taxonomy";

export { siteV2TopicsForBook } from "@/lib/siteV2Taxonomy";

export const SITE_V2_SAVED_KEY = "jju.savedBooks";

const SITE_V2_CARD_DESCRIPTIONS: Record<string, string> = {
  science: "How science became a way of testing the world, from early observers and Greek argument to microscopes, atoms, computers, and the questions we still can't answer.",
  fields: "The universe isn't built from tiny solid pieces. Quantum field theory says particles are ripples in fields, and this book explains what that actually means.",
  humans: "Human history at full speed, from the Big Bang to the 2020s, with the recurring code behind empires, money, nations, collapse, and power exposed along the way.",
  bible: "The Bible's main story in plain language, from creation and covenant through Jesus, the early church, the letters, Revelation, and the return of the Tree of Life.",
  addiction: "From opium and cigarettes to OxyContin, rehab, vapes, apps, and infinite scroll, ADDICTION follows the industries that learned how to sell dependence.",
  king: "Martin Luther King Jr. before the holiday and the statue: exhausted, watched, threatened, criticized, and still pushing America toward a dream it has never finished.",
  games: "How video games went from lab experiments and arcade cabinets to DLC, loot boxes, battle passes, subscriptions, and a fight over whether play still belongs to players.",
  nicotine: "Nicotine's path from sacred plant to imperial crop, cigarette machine, vape, pouch, and craving loop.",
  van: "Vincent van Gogh as a man before he became a myth, held together by painting, illness, and hundreds of letters to his brother Theo.",
  scisim: "A short, informal guide that connects energy to motion, matter, fields, cells, chemistry, bonds, geometry, and everyday life.",
  watchtower: "The Watchtower's end-times predictions, two classes of salvation, and rules on shunning, blood, and dissent, traced from Charles Taze Russell to the Governing Body.",
  vibes: "Why music gets into your body, your memories, your politics, and your sense of belonging, from bone flutes and Mozart to burned CDs, Spotify, and SoundCloud.",
  witches: "How everyday magic became a capital crime, why frightened communities needed scapegoats, and how torture turned accusation into proof.",
  pregnancy: "Pregnancy without the polished version: what changes, what it costs, what labor can look like, how newborns work, and how to keep yourself intact.",
  crust: "Pizza's trip from ancient flatbread to immigrant food, delivery empire, frozen aisle, cartoon icon, regional argument, and global comfort ritual.",
  pixar: "Thirteen Pixar movies used to talk about identity, grief, purpose, memory, family, talent, and the feelings people usually try to outrun.",
  off: "How corporations and billionaires move wealth through loopholes, shell companies, tax havens, accounting tricks, and a professional industry built to protect fortunes.",
  rome: "Rome rises from a founding myth into a republic, an empire, and eventually a ruin. The book follows the rulers and institutions that made it durable, brilliant, and dangerous.",
  antarctica: "After centuries as an imagined continent, Antarctica became a prize for explorers and governments. Now its ice holds evidence about the past and warnings about the future.",
  astral: "What people mean by astral projection, how it overlaps with lucid dreaming, and why the experience can feel terrifyingly real. The book stays curious without losing its grip on reality.",
  liberated: "Freddie Mercury and Elton John turned spectacle into freedom. This book follows the art, sexuality, loneliness, illness, and nerve behind two lives that changed what a performer could be.",
  looped: "Groundhog Day becomes a manual for recognizing the routines that keep people stuck. Repetition can be a prison, but it can also become practice.",
  odds: "Coins, forecasts, streaks, lotteries, birthdays, love, and the bad instincts people bring to probability. A practical tour of why chance rarely feels as random as it is.",
  jackson: "Andrew Jackson built his reputation through violence, war, and populist theater. This biography follows the victories he celebrated, the people he destroyed, and the legacy still printed on the twenty-dollar bill.",
  chakras: "A modern guide to the seven-chakra system and what each center is meant to represent. The book treats the framework as a practical language for attention, emotion, expression, and balance.",
  economics: "Economics from early exchange and the first coins to capitalism, financial crashes, global trade, digital currency, and the arguments over what should come next.",
  ww1: "The First World War from the assassination in Sarajevo to the trenches, colonial battlefields, collapsing empires, American intervention, and the Treaty of Versailles.",
  shake: "Shakespeare as working playwright, businessman, celebrity, and permanent ghost in the English language. The book moves from Stratford and the Globe through the tragedies, dirty jokes, authorship fights, and centuries of afterlife.",
  islam: "Islam from Muhammad's Mecca and the first community in Medina through caliphates, schism, empire, colonialism, modern politics, and ordinary Muslim life.",
};

export const SITE_V2_SHELVES = [
  {
    id: "history-civilization",
    name: "History & Civilization",
    shortName: "History",
    description: "People, places, eras, and the worlds they left behind.",
    tags: [
      "20th Century",
      "African History",
      "American History",
      "Ancient Civilizations",
      "Ancient Egypt",
      "Ancient Greece",
      "Ancient Rome",
      "Asian History",
      "Biography",
      "British History",
      "Chinese History",
      "Cultural History",
      "European History",
      "French History",
      "Medieval History",
      "Middle Eastern History",
      "Renaissance",
      "Russian History",
      "Victorian Era",
    ],
  },
  {
    id: "power-politics-war",
    name: "Power, Politics & War",
    shortName: "Power",
    description: "Government, empire, conflict, propaganda, and control.",
    tags: [
      "American Politics",
      "American Presidents",
      "Authoritarianism & Dictatorship",
      "Civil Rights & Social Justice",
      "Cold War",
      "Colonialism & Empire",
      "Conspiracy & Cover-ups",
      "Espionage & Intelligence",
      "Government & Politics",
      "Military History",
      "Political Theory",
      "Propaganda & Social Control",
      "Revolution & Social Change",
      "Slavery & Abolition",
      "Social Movements",
      "Vietnam War",
      "War & Conflict",
      "World War I",
      "World War II",
    ],
  },
  {
    id: "science-nature",
    name: "Science & Nature",
    shortName: "Science",
    description: "Matter, life, bodies, space, mathematics, and discovery.",
    tags: [
      "Biology & Medicine",
      "Environmental Issues",
      "Physics & Cosmology",
      "Public Health",
      "Science & Mathematics",
      "Science History",
      "Space Exploration",
    ],
  },
  {
    id: "mind-behavior",
    name: "Mind & Behavior",
    shortName: "Minds",
    description: "Brains, belief, addiction, identity, and the self.",
    tags: [
      "Addiction & Substance Use",
      "Cognitive Science & Neuroscience",
      "Psychology & Human Behavior",
      "Sociology",
    ],
  },
  {
    id: "religion-philosophy",
    name: "Religion & Philosophy",
    shortName: "Belief",
    description: "Scripture, ethics, meaning, mysticism, and big arguments.",
    tags: [
      "Buddhism",
      "Christianity",
      "Cults & Extremism",
      "Eastern Philosophy & Religion",
      "Islam",
      "Mythology & Ancient Beliefs",
      "Philosophy",
      "Religion & Spirituality",
      "Spirituality & Mysticism",
      "World Religions",
    ],
  },
  {
    id: "culture-media-technology",
    name: "Culture, Media & Technology",
    shortName: "Culture",
    description: "Art, media, platforms, inventions, and everyday life.",
    tags: [
      "Art & Music History",
      "Consumer Culture",
      "Digital Culture & Technology",
      "Food & Culture",
      "Technology & Innovation",
    ],
  },
  {
    id: "money-work-systems",
    name: "Money, Work & Systems",
    shortName: "Money",
    description: "Markets, labor, corporations, incentives, and institutions.",
    tags: [
      "Business & Economics",
      "Capitalism & Corporations",
      "Political Economy",
    ],
  },
] as const;

export function isSiteV2ShelfId(value: string): value is SiteV2ShelfId {
  return SITE_V2_SHELVES.some(shelf => shelf.id === value);
}

export function siteV2ShelvesForBook(book: Pick<PublishedBook, "id" | "tags">) {
  const reviewedShelfIds = new Set<SiteV2ShelfId>(SITE_V2_SHELF_IDS_BY_BOOK[book.id] || []);
  const topics = new Set(siteV2TopicsForBook(book));
  return SITE_V2_SHELVES.filter(shelf => (
    reviewedShelfIds.has(shelf.id) || shelf.tags.some(tag => topics.has(tag))
  ));
}

function siteV2ShelfForBook(book: Pick<PublishedBook, "id" | "tags" | "primaryCategory">) {
  const shelves = siteV2ShelvesForBook(book);
  if (shelves.length === 1) return shelves[0];

  const currentToDraft: Record<string, SiteV2ShelfId> = {
    History: "history-civilization",
    Power: "power-politics-war",
    War: "power-politics-war",
    Science: "science-nature",
    "Human Nature": "mind-behavior",
    Religion: "religion-philosophy",
    Philosophy: "religion-philosophy",
    Culture: "culture-media-technology",
    Technology: "culture-media-technology",
    Economics: "money-work-systems",
  };
  const preferred = currentToDraft[book.primaryCategory];
  return shelves.find(shelf => shelf.id === preferred) || shelves[0];
}

export function siteV2ShelfLabel(book: Pick<PublishedBook, "id" | "tags" | "primaryCategory">) {
  const shelves = siteV2ShelvesForBook(book);
  const lead = siteV2ShelfForBook(book);
  if (!lead) return book.primaryCategory || "Books";
  const additional = Math.max(0, shelves.length - 1);
  return additional ? `${lead.name} +${additional} more` : lead.name;
}

export function siteV2ShelfShortLabel(book: Pick<PublishedBook, "id" | "tags" | "primaryCategory">) {
  const shelves = siteV2ShelvesForBook(book);
  const lead = siteV2ShelfForBook(book);
  if (!lead) return book.primaryCategory || "Books";
  const additional = Math.max(0, shelves.length - 1);
  return additional ? `${lead.shortName} +${additional}` : lead.shortName;
}

export function formatBookLength(book: Pick<PublishedBook, "readingLabel" | "readingMinutes">) {
  if (book.readingLabel && book.readingLabel !== "Unknown") return book.readingLabel;
  if (book.readingMinutes > 0) return `${book.readingMinutes} min`;
  return "Short book";
}

export function siteV2Description(book: Pick<PublishedBook, "id" | "description">) {
  return SITE_V2_CARD_DESCRIPTIONS[book.id] || book.description;
}

export function siteV2CoverSrc(book: Pick<PublishedBook, "id" | "coverFile">) {
  const source = String(book.coverFile || book.id || "file").trim();
  if (/^https?:\/\//i.test(source) || source.startsWith("data:")) return source;
  const fileName = decodeURIComponent(source).split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() || source;
  const stem = fileName.replace(/\.[^.]+$/, "");
  return `/covers-webp/${encodeURIComponent(`${stem}.webp`)}`;
}
