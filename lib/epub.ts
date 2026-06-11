import { deflateRawSync, inflateRawSync } from "zlib";

export type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type EpubChapter = {
  id: string;
  title: string;
  html: string;
  fullHtml: string;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function findEndOfCentralDirectory(buffer: Buffer) {
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }

  throw new Error("Invalid EPUB zip.");
}

export function readZipEntries(buffer: Buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.set(name, { name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export function readEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid zip entry: ${entry.name}`);
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported compression in ${entry.name}.`);
}

export function textEntry(buffer: Buffer, entries: Map<string, ZipEntry>, name: string) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`Missing EPUB entry: ${name}`);
  return readEntry(buffer, entry).toString("utf8");
}

export function attr(source: string, name: string) {
  return source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] || "";
}

export function dirname(filePath: string) {
  const dir = filePath.split("/").slice(0, -1).join("/");
  return dir ? `${dir}/` : "";
}

export function absolutize(base: string, href: string) {
  const parts = `${base}${href}`.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }

  return resolved.join("/");
}

export function extractBody(html: string) {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
}

export function replaceBody(fullHtml: string, bodyHtml: string) {
  if (!/<body[^>]*>[\s\S]*?<\/body>/i.test(fullHtml)) return bodyHtml;
  return fullHtml.replace(/(<body[^>]*>)[\s\S]*?(<\/body>)/i, `$1${bodyHtml}$2`);
}

export function stripScripts(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+=["'][\s\S]*?["']/gi, "");
}

export function readEpubChapters(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const container = textEntry(buffer, entries, "META-INF/container.xml");
  const opfPath = attr(container, "full-path");
  const opf = textEntry(buffer, entries, opfPath);
  const opfBase = dirname(opfPath);
  const manifest = new Map<string, string>();

  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const itemTag = match[0];
    const itemId = attr(itemTag, "id");
    const href = attr(itemTag, "href");
    if (itemId && href) manifest.set(itemId, absolutize(opfBase, href));
  }

  return [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map(match => manifest.get(attr(match[0], "idref")))
    .filter((href): href is string => Boolean(href))
    .filter(href => /\.(xhtml|html?)$/i.test(href))
    .map((href, index): EpubChapter => {
      const fullHtml = textEntry(buffer, entries, href);
      return {
        id: href,
        title: `Chapter ${index + 1}`,
        html: stripScripts(extractBody(fullHtml)),
        fullHtml,
      };
    });
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimeDate(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { time, date: (year << 9) | (month << 5) | day };
}

export function rewriteZip(buffer: Buffer, replacements: Map<string, Buffer>) {
  const entries = [...readZipEntries(buffer).values()];
  const fileRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  const stamp = dosTimeDate();

  for (const entry of entries) {
    const source = replacements.get(entry.name) || readEntry(buffer, entry);
    const compression = entry.name === "mimetype" ? 0 : entry.compression;
    const compressed = compression === 0 ? source : deflateRawSync(source);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(source);
    const localOffset = offset;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(compression, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    fileRecords.push(local, compressed);
    offset += local.length + compressed.length;

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(compression, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...fileRecords, central, eocd]);
}
