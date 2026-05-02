import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

const processes = [];
let shuttingDown = false;
const projectRoot = process.cwd();
const rcsPort = Number(process.env.RCS_PORT || 8080);
const webPort = 5173;

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[dev:all] ${name} exited with ${detail}`);
    shutdown(code ?? 0);
  });

  processes.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    for (const child of processes) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    setTimeout(() => process.exit(exitCode), 100);
    return;
  }

  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(exitCode), 100);
}

function ensureSafePath(path) {
  const normalized = path.replace(/\\/g, "/");
  const root = projectRoot.replace(/\\/g, "/");
  if (!normalized.startsWith(root)) {
    throw new Error(`Refusing to delete path outside project root: ${path}`);
  }
  if (normalized === root || normalized === "/" || normalized.length < root.length + 4) {
    throw new Error(`Refusing to delete unsafe path: ${path}`);
  }
}

function removePath(path) {
  ensureSafePath(path);
  rmSync(path, { force: true, recursive: true });
}

function resetDevState() {
  const paths = [
    join(projectRoot, "rcs.sqlite"),
    join(projectRoot, "rcs.sqlite-shm"),
    join(projectRoot, "rcs.sqlite-wal"),
    join(projectRoot, "packages/remote-control-server/rcs.sqlite"),
    join(projectRoot, "packages/remote-control-server/rcs.sqlite-shm"),
    join(projectRoot, "packages/remote-control-server/rcs.sqlite-wal"),
    join(projectRoot, ".data"),
    join(projectRoot, ".excalidraw_mcp"),
  ];

  for (const path of paths) {
    removePath(path);
  }
}

function assertPortAvailable(port, label) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      reject(new Error(`${label} port ${port} is already in use`));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve();
      });
    });
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await assertPortAvailable(rcsPort, "RCS");
await assertPortAvailable(webPort, "web");
resetDevState();

start("rcs", "bun", ["run", "rcs"], { cwd: process.cwd() });
start("web", "bun", ["run", "dev"], { cwd: new URL("../web", import.meta.url) });
