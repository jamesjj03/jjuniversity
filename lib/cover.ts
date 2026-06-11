export type CoverSource = {
  id?: string;
  cover?: string;
  coverFile?: string;
};

function isExternalCover(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("data:");
}

function fileName(value: string) {
  return decodeURIComponent(value).split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() || value;
}

function stem(value: string) {
  return fileName(value).replace(/\.[^.]+$/, "");
}

function sourceName(book: CoverSource | undefined, fallbackId = "") {
  return String(book?.coverFile || book?.cover || book?.id || fallbackId || "file").trim();
}

export function coverWebpSrc(book: CoverSource | undefined, fallbackId = "") {
  const source = sourceName(book, fallbackId);
  if (isExternalCover(source)) return source;
  return `/covers-webp/${encodeURIComponent(stem(source))}.webp`;
}

export function coverFallbackSrc(book: CoverSource | undefined, fallbackId = "") {
  const source = sourceName(book, fallbackId);
  if (isExternalCover(source)) return source;
  if (source.startsWith("/")) return source;
  return `/covers/${source.includes(".") ? source : `${source}.jpg`}`;
}

export function handleCoverError(image: HTMLImageElement) {
  const fallback = image.dataset.fallbackSrc;
  if (fallback && image.getAttribute("src") !== fallback) {
    image.src = fallback;
    return;
  }

  image.src = "/file.svg";
  image.classList.add("coverMissing");
}
