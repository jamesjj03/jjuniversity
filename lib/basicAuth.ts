export function decodeBasicCredentials(auth: string) {
  try {
    const encoded = auth.slice("Basic ".length).trim();
    if (!auth.startsWith("Basic ") || !encoded) return null;
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}
