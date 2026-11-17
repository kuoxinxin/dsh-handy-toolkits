#!/usr/bin/env node
// Refresh the mermaid engine baked into lib/client.js.
//
// The chat loads this bundle from the plugin route, so the engine cannot be a
// sibling file: it has to travel inside client.js. Gzip + base64 keeps the
// source constant small (~1.3 MB for 3.5 MB of mermaid) and the client inflates
// it only when the first ```mermaid fence appears.
//
//   node scripts/vendor-mermaid.mjs              # latest pinned version
//   node scripts/vendor-mermaid.mjs 11.17.2      # a specific version
//   node scripts/vendor-mermaid.mjs ./mermaid.min.js
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(PACKAGE_ROOT, "lib", "client.js");
const DEFAULT_VERSION = "11.17.2";
const PAYLOAD = /(\t\tconst MERMAID_PAYLOAD = ")[^"]*(";)/;

/** Read the engine source from a local file or from the npm tarball. */
function readEngine(source) {
	if (source.endsWith(".js")) return readFileSync(resolve(source));
	const scratch = mkdtempSync(join(tmpdir(), "dsh-mermaid-"));
	try {
		const tarball = execFileSync("npm", ["pack", `mermaid@${source}`, "--silent", "--pack-destination", scratch], {
			cwd: scratch,
			encoding: "utf8"
		})
			.trim()
			.split("\n")
			.at(-1);
		return execFileSync("tar", ["-xzOf", join(scratch, tarball), "package/dist/mermaid.min.js"], {
			maxBuffer: 64 * 1024 * 1024
		});
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

const source = process.argv[2] ?? DEFAULT_VERSION;
const engine = readEngine(source);
if (engine.length < 100_000) throw new Error(`refusing to vendor ${engine.length} bytes from ${source}`);

const payload = gzipSync(engine, { level: 9 }).toString("base64");
const client = readFileSync(CLIENT, "utf8");
if (!PAYLOAD.test(client)) throw new Error(`lib/client.js has no MERMAID_PAYLOAD line to replace`);
writeFileSync(CLIENT, client.replace(PAYLOAD, `$1${payload}$2`));
console.log(`vendored ${source}: ${engine.length} B source → ${payload.length} B payload in lib/client.js`);