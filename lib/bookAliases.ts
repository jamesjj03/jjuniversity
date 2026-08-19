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

export function bookIdAliasFamily(id: string) {
  const canonicalId = canonicalBookId(id);
  return [
    canonicalId,
    ...Object.entries(LEGACY_BOOK_ID_ALIASES)
      .filter(([, target]) => target === canonicalId)
      .map(([alias]) => alias),
  ];
}
