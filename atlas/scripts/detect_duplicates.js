const { loadNodes, normalizeAlias } = require("./atlas_utils");

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function similarity(a, b) {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) {
    return 1;
  }
  return 1 - levenshtein(a, b) / longer;
}

function main() {
  const entries = loadNodes();
  const ids = new Map();
  const titles = new Map();
  const aliases = new Map();
  const exact = [];
  const near = [];

  for (const entry of entries) {
    const node = entry.node;
    if (ids.has(node.id)) {
      exact.push(`duplicate id ${node.id}: ${ids.get(node.id)} and ${entry.relativePath}`);
    }
    ids.set(node.id, entry.relativePath);

    const normalizedTitle = normalizeAlias(node.title);
    if (titles.has(normalizedTitle)) {
      exact.push(`duplicate title ${node.title}: ${titles.get(normalizedTitle)} and ${entry.relativePath}`);
    }
    titles.set(normalizedTitle, entry.relativePath);

    for (const alias of node.aliases || []) {
      const normalizedAlias = normalizeAlias(alias);
      if (aliases.has(normalizedAlias) && aliases.get(normalizedAlias) !== node.id) {
        exact.push(`alias collision "${alias}": ${aliases.get(normalizedAlias)} and ${node.id}`);
      }
      aliases.set(normalizedAlias, node.id);
    }
  }

  const titleList = entries.map((entry) => ({
    id: entry.node.id,
    title: normalizeAlias(entry.node.title)
  }));

  for (let i = 0; i < titleList.length; i += 1) {
    for (let j = i + 1; j < titleList.length; j += 1) {
      const a = titleList[i];
      const b = titleList[j];
      if (a.title.length < 8 || b.title.length < 8) {
        continue;
      }
      if (similarity(a.title, b.title) >= 0.92) {
        near.push(`${a.id} ~ ${b.id}`);
      }
    }
  }

  if (exact.length > 0) {
    console.error(`Exact Atlas duplicates found (${exact.length}):`);
    for (const duplicate of exact) {
      console.error(`- ${duplicate}`);
    }
    process.exit(1);
  }

  if (near.length > 0) {
    console.warn(`Near Atlas duplicates to review (${near.length}):`);
    for (const duplicate of near) {
      console.warn(`- ${duplicate}`);
    }
  } else {
    console.log(`No Atlas duplicates found across ${entries.length} node(s).`);
  }
}

main();
