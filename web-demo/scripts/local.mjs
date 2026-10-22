// Runs both Workers on loopback with `wrangler dev`.
//   product: http://127.0.0.1:8787   host: http://127.0.0.1:8788
// Different ports are different origins, the same as two workers.dev hostnames.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PRODUCT = "http://127.0.0.1:8787";
export const HOST = "http://127.0.0.1:8788";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(env, port, inspectorPort) {
  const args = [
    "dev", "--env", env, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort),
    "--var", `PRODUCT_ORIGIN:${PRODUCT}`, "--var", `HOST_ORIGIN:${HOST}`, "--show-interactive-dev-session=false",
    // One state directory per Worker. A shared one makes start-up fail with SQLITE_BUSY.
    "--persist-to", `.wrangler/state-${env}`,
  ];
  const child = spawn(`${root}node_modules/.bin/wrangler`, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const ready = new Promise((resolve, reject) => {
    let log = "";
    const onData = (d) => {
      log += d;
      if (/Ready on/.test(log)) resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`wrangler dev --env ${env} exited ${code}\n${log}`)));
  });
  return { child, ready };
}

export async function startLocal() {
  const procs = [run("host", 8788, 9330), run("product", 8787, 9331)];
  // Kill each process group, so that workerd children stop too.
  const stop = () =>
    Promise.all(
      procs.map(
        (p) =>
          new Promise((resolve) => {
            if (p.child.exitCode !== null) return resolve();
            p.child.once("exit", resolve);
            try { process.kill(-p.child.pid, "SIGTERM"); } catch { resolve(); }
          }),
      ),
    );
  try {
    await Promise.all(procs.map((p) => p.ready));
  } catch (e) {
    await stop();
    throw e;
  }
  return { stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { stop } = await startLocal();
  console.log(`Product page: ${PRODUCT}\nHost:         ${HOST}\nPress Ctrl+C to stop.`);
  process.on("SIGINT", async () => {
    await stop();
    process.exit(0);
  });
}
