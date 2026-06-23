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

function supabaseCoverUrl(file: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "covers";
  if (!supabaseUrl) return "";
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(file)}`;
}

function sourceName(book: CoverSource | undefined, fallbackId = "") {
  return String(book?.coverFile || book?.cover || book?.id || fallbackId || "file").trim();
}

export function coverWebpSrc(book: CoverSource | undefined, fallbackId = "") {
  const source = sourceName(book, fallbackId);
  if (isExternalCover(source)) return source;
  const webpFile = `${stem(source)}.webp`;
  return supabaseCoverUrl(webpFile) || `/covers-webp/${encodeURIComponent(webpFile)}`;
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
