const { loadNodes } = require("./atlas_utils");

function main() {
  const entries = loadNodes();
  const ids = new Set(entries.map((entry) => entry.node.id));
  const errors = [];

  for (const entry of entries) {
    const node = entry.node;
    for (const relation of ["prerequisites", "unlocks", "related"]) {
      for (const target of node[relation] || []) {
        if (!ids.has(target)) {
          errors.push(`${node.id}: ${relation} -> ${target}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Broken Atlas links found (${errors.length}):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`No broken Atlas links found across ${entries.length} node(s).`);
}

main();
