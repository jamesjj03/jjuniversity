#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const lockPath = path.join(repositoryRoot, "data", "atlas", "sources.lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const cacheRoot = path.resolve(repositoryRoot, lock.cacheDirectory);

const args = new Set(process.argv.slice(2));
const requestedGroup = process.argv.find((value) => value.startsWith("--group="))?.split("=")[1] ?? "all";
const verifyOnly = args.has("--verify-only");
const repair = args.has("--repair");

function assertInsideCache(targetPath) {
  const relative = path.relative(cacheRoot, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to mutate a path outside the Atlas source cache: ${targetPath}`);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256Factbook(root, fileSet) {
  const jsonDirectory = path.join(root, fileSet.jsonDirectory);
  const names = (await readdir(jsonDirectory)).filter((name) => name.endsWith(".json")).sort();
  const files = [
    ...names.map((name) => path.join(jsonDirectory, name)),
    ...fileSet.additionalFiles.map((name) => path.join(root, name)),
  ].sort();
  const hash = createHash("sha256");
  for (const filePath of files) {
    hash.update(path.relative(root, filePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runCapture(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function verifyHttp(source, targetPath) {
  if (!(await exists(targetPath))) return false;
  const metadata = await stat(targetPath);
  if (metadata.size !== source.expectedBytes) return false;
  return (await sha256File(targetPath)) === source.checksumSha256;
}

async function fetchHttp(source, targetPath) {
  if (await verifyHttp(source, targetPath)) return "verified";
  if (verifyOnly) throw new Error(`Missing or invalid locked source: ${source.target}`);
  if ((await exists(targetPath)) && !repair) {
    throw new Error(`Locked source differs from the manifest: ${source.target}. Re-run with --repair to replace only this cache copy.`);
  }

  assertInsideCache(targetPath);
  const partialPath = `${targetPath}.partial`;
  await rm(partialPath, { force: true });
  if (source.embeddedSnapshot) {
    const seedRoot = path.resolve(repositoryRoot, "data", "atlas", "source-seeds");
    const seedPath = path.resolve(repositoryRoot, source.embeddedSnapshot);
    const seedRelative = path.relative(seedRoot, seedPath);
    if (!seedRelative || seedRelative.startsWith("..") || path.isAbsolute(seedRelative)) {
      throw new Error(`Embedded Atlas source escapes data/atlas/source-seeds: ${source.embeddedSnapshot}`);
    }
    if (!(await verifyHttp(source, seedPath))) {
      throw new Error(`Embedded Atlas source does not match the lock: ${source.embeddedSnapshot}`);
    }
    await copyFile(seedPath, partialPath);
    await rm(targetPath, { force: true });
    await rename(partialPath, targetPath);
    return "restored";
  }

  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${source.url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));
  const partialSize = (await stat(partialPath)).size;
  const partialHash = await sha256File(partialPath);
  if (partialSize !== source.expectedBytes || partialHash !== source.checksumSha256) {
    await rm(partialPath, { force: true });
    throw new Error(
      `Integrity check failed for ${source.id}: expected ${source.expectedBytes} bytes/${source.checksumSha256}, got ${partialSize}/${partialHash}`,
    );
  }
  await rm(targetPath, { force: true });
  await rename(partialPath, targetPath);
  return "downloaded";
}

async function gitHead(targetPath) {
  return (await runCapture("git", ["-C", targetPath, "rev-parse", "HEAD"], repositoryRoot)).trim();
}

async function verifyGit(source, targetPath) {
  if (!(await exists(path.join(targetPath, ".git")))) return false;
  let head;
  try {
    head = await gitHead(targetPath);
  } catch {
    return false;
  }
  if (head !== source.commit) return false;
  return (await sha256Factbook(targetPath, source.fileSet)) === source.checksumSha256;
}

async function fetchGit(source, targetPath) {
  if (await verifyGit(source, targetPath)) return "verified";
  if (verifyOnly) throw new Error(`Missing or invalid locked Git source: ${source.target}`);
  if ((await exists(targetPath)) && !repair) {
    throw new Error(`Locked Git source differs from the manifest: ${source.target}. Re-run with --repair to replace only this cache copy.`);
  }

  assertInsideCache(targetPath);
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(targetPath, { recursive: true });
  await run("git", ["init", "--quiet"], targetPath);
  await run("git", ["remote", "add", "origin", source.url], targetPath);
  await run("git", ["sparse-checkout", "init", "--cone"], targetPath);
  await run("git", ["sparse-checkout", "set", ...source.sparsePaths], targetPath);
  await run("git", ["fetch", "--quiet", "--depth", "1", "origin", source.commit], targetPath);
  await run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], targetPath);

  if (!(await verifyGit(source, targetPath))) {
    throw new Error(`Git source integrity check failed for ${source.id}`);
  }
  return "downloaded";
}

await mkdir(cacheRoot, { recursive: true });
const selected = lock.sources.filter(
  (source) => requestedGroup === "all" || source.group === requestedGroup,
);
if (!selected.length) throw new Error(`No Atlas sources matched group '${requestedGroup}'.`);

const receipt = [];
for (const source of selected) {
  const targetPath = path.resolve(cacheRoot, source.target);
  assertInsideCache(targetPath);
  const result = source.kind === "git"
    ? await fetchGit(source, targetPath)
    : await fetchHttp(source, targetPath);
  receipt.push({ id: source.id, result, target: path.relative(repositoryRoot, targetPath) });
  console.log(`${result.padEnd(10)} ${source.id}`);
}

console.log(`Atlas source lock satisfied: ${receipt.length} source(s) in ${path.relative(repositoryRoot, cacheRoot)}.`);
