import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const TOOL_ROOT = path.join(REPOSITORY_ROOT, "data", "atlas", "tool-cache");
const VIRTUAL_ENVIRONMENT = path.join(TOOL_ROOT, "geography-python-3.11");
const REQUIREMENTS_PATH = path.join(SCRIPT_DIRECTORY, "atlas-geography-requirements.txt");
const BUILD_SCRIPT = path.join(SCRIPT_DIRECTORY, "build-atlas-geography-pack.py");
const STAMP_PATH = path.join(VIRTUAL_ENVIRONMENT, ".atlas-requirements.sha256");
const VENV_PYTHON = path.join(
  VIRTUAL_ENVIRONMENT,
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
}

function canRun(command, args) {
  const result = spawnSync(command, args, { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  return !result.error && result.status === 0;
}

function findBootstrapPython() {
  if (process.env.ATLAS_PYTHON) return { command: process.env.ATLAS_PYTHON, args: [] };
  const candidates =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3.11"] },
          { command: "python", args: [] },
          { command: "python3", args: [] },
        ]
      : [
          { command: "python3.11", args: [] },
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];
  for (const candidate of candidates) {
    if (canRun(candidate.command, [...candidate.args, "-c", "import sys; raise SystemExit(sys.version_info[:2] != (3, 11))"])) {
      return candidate;
    }
  }
  throw new Error(
    "Atlas geography builds require Python 3.11. Install it or set ATLAS_PYTHON to a Python 3.11 executable.",
  );
}

await mkdir(TOOL_ROOT, { recursive: true });
if (!existsSync(VENV_PYTHON)) {
  const bootstrap = findBootstrapPython();
  console.log(`Creating the Atlas geography Python environment at ${path.relative(REPOSITORY_ROOT, VIRTUAL_ENVIRONMENT)}.`);
  run(bootstrap.command, [...bootstrap.args, "-m", "venv", VIRTUAL_ENVIRONMENT]);
}

const requirements = await readFile(REQUIREMENTS_PATH);
const normalizedRequirements = requirements.toString("utf8").replaceAll("\r\n", "\n");
const requirementsHash = createHash("sha256").update(normalizedRequirements).digest("hex");
const installedHash = existsSync(STAMP_PATH) ? readFileSync(STAMP_PATH, "utf8").trim() : null;
if (installedHash !== requirementsHash) {
  console.log("Installing the exact Atlas geography build dependencies.");
  run(VENV_PYTHON, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--only-binary=:all:",
    "-r",
    REQUIREMENTS_PATH,
  ]);
  writeFileSync(STAMP_PATH, `${requirementsHash}\n`, "utf8");
}

run(VENV_PYTHON, [BUILD_SCRIPT, ...process.argv.slice(2)]);
run(process.execPath, [path.join(SCRIPT_DIRECTORY, "reproject-atlas-notes.mjs")]);
