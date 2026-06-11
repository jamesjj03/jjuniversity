const { loadNodes } = require("./atlas_utils");

function main() {
  const entries = loadNodes();
  const prereqById = new Map(entries.map((entry) => [entry.node.id, entry.node.prerequisites || []]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(id, path) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }

    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    for (const prerequisiteId of prereqById.get(id) || []) {
      visit(prerequisiteId, [...path, prerequisiteId]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of prereqById.keys()) {
    visit(id, [id]);
  }

  if (cycles.length > 0) {
    console.error(`Circular Atlas prerequisites found (${cycles.length}):`);
    for (const cycle of cycles) {
      console.error(`- ${cycle.join(" -> ")}`);
    }
    process.exit(1);
  }

  console.log(`No circular Atlas prerequisites found across ${entries.length} node(s).`);
}

main();
