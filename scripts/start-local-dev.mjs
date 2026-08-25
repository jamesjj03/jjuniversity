import { spawn } from "node:child_process";
import path from "node:path";

const forwarded = [];
const args = process.argv.slice(2);

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--port" || value === "-p") {
    const port = args[index + 1];
    if (!/^\d{2,5}$/.test(String(port || ""))) {
      throw new Error("Local dev --port must be a number between 10 and 99999.");
    }
    forwarded.push("--port", port);
    index += 1;
    continue;
  }
  if (/^--port=\d{2,5}$/.test(value)) {
    forwarded.push(value);
    continue;
  }
  throw new Error(`Unsupported local dev option: ${value}. The server is intentionally pinned to 127.0.0.1.`);
}

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", ...forwarded],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
