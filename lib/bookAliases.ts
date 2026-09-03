export const LEGACY_BOOK_ID_ALIASES: Readonly<Record<string, string>> = {
  field: "fields",
  music: "vibes",
  nic: "nicotine",
  odd: "odds",
  prenancy: "pregnancy",
  vangogh: "van",
  videogames: "games",
};

export function canonicalBookId(id: string) {
  const normalized = id.trim().toLowerCase();
  return LEGACY_BOOK_ID_ALIASES[normalized] || normalized;
}

// This has to stay safe to import from browser code. It mirrors the public-book
// URL format, so the Reader can accept a shareable book URL as well as an ID.
export function slugifyBookRoute(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function bookIdAliasFamily(id: string) {
  const canonicalId = canonicalBookId(id);
  return [
    canonicalId,
    ...Object.entries(LEGACY_BOOK_ID_ALIASES)
      .filter(([, target]) => target === canonicalId)
      .map(([alias]) => alias),
  ];
}
