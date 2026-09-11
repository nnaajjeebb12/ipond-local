/**
 * Sign a license file with the Soletronix private key.
 *
 * Usage:
 *   node --experimental-strip-types scripts/generate-license.ts \
 *     --client "Acme Aquafarms" --serial 100000001a2b3c4d --days 1825 \
 *     --out license.json
 *
 * --serial ANY issues a machine-independent license (dev boxes, VMs, x86).
 * The private key never ships with an appliance — keep keys/ off deployed hosts.
 */
import { createSign, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SIGNED_FIELDS = ["licenseId", "client", "piSerial", "issuedAt", "expiresAt"] as const;

type Payload = Record<(typeof SIGNED_FIELDS)[number], string>;

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

function canonicalize(payload: Payload): string {
  const ordered: Record<string, string> = {};
  for (const key of [...SIGNED_FIELDS].sort()) ordered[key] = String(payload[key]);
  return JSON.stringify(ordered);
}

const keyPath = arg("key", path.join(process.cwd(), "keys", "soletronix_private.pem"));
const outPath = arg("out", path.join(process.cwd(), "license.json"));
const days = Number(arg("days", "1825"));
if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);

const payload: Payload = {
  licenseId: arg("id", randomUUID()),
  client: arg("client"),
  piSerial: arg("serial", "ANY"),
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
};

const signer = createSign("RSA-SHA256");
signer.update(canonicalize(payload), "utf8");
signer.end();
const signature = signer.sign(readFileSync(keyPath, "utf8"), "base64");

writeFileSync(outPath, `${JSON.stringify({ ...payload, signature }, null, 2)}\n`, "utf8");
console.log(`wrote ${outPath}`);
console.log(`  client    ${payload.client}`);
console.log(`  piSerial  ${payload.piSerial}`);
console.log(`  expiresAt ${payload.expiresAt} (${days} days)`);
