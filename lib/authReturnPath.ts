const AUTH_RETURN_BASE = "https://jju-return.invalid";
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001f\u007f-\u009f]/u;

function hasUnsafePathCharacters(value: string) {
  let decoded = value;

  try {
    for (let pass = 0; pass < 3; pass += 1) {
      if (UNSAFE_PATH_CHARACTERS.test(decoded) || decoded.startsWith("//")) return true;
      const next = decodeURIComponent(decoded);
      if (next === decoded) return false;
      decoded = next;
    }
  } catch {
    return true;
  }

  return UNSAFE_PATH_CHARACTERS.test(decoded) || decoded.startsWith("//");
}

export function safeAuthReturnPath(
  value: string | null | undefined,
  fallback = "/account",
  origin = AUTH_RETURN_BASE,
) {
  if (!value || !value.startsWith("/") || hasUnsafePathCharacters(value)) return fallback;

  try {
    const base = new URL(origin);
    const target = new URL(value, base);
    if (target.origin !== base.origin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
