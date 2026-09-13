import { createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Soletronix license verification — offline, RSA-SHA256.
 *
 * The license file is a JSON document signed by Soletronix with the private
 * half of the keypair below. The file read, signature check and device-serial
 * check are cached per process; expiry is re-evaluated on every call so a
 * long-running server still locks itself out the day the license lapses.
 * There is no runtime override and no bypass flag.
 *
 * Replace SOLETRONIX_PUBLIC_KEY with the production public key before shipping
 * appliances — the matching private key must never leave Soletronix.
 */
const SOLETRONIX_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxDgF8wiAFO40Zy34Vs1q
PlzTAOAbrG3H7mGFTZNf/j3L9O9z0O4PC4qjZjSMLCPLJMc4cAZDoTOTSAXzwYm7
VdGvV0erJ35VrOh52DbYSWVi5p/eI4VM7pU+ll9JIHiBCvzecoYv0PbXsY+1SV/o
Bll29YfMErkDV6RfxpAKHrlwdeleojsjfWbe8eh/4xHyl5gtG2HQWrSIQP6xwY2q
YMDD86akTZ697eZjhlsrZvfM6YiQuuPBNcUIXSBgUoNJaUaMUY1jVOoehZ2eilPw
lFKBRqqDRBLr6KeGZmIbslzmboSTK+og4URs3qjLGnfc8O1bd3m9UEBY/ZrBF6sa
eQIDAQAB
-----END PUBLIC KEY-----
`;

/** Serial wildcard — signed by Soletronix for non-Pi installs (dev, VM, x86 box). */
const ANY_SERIAL = "ANY";

const CPUINFO_PATH = "/proc/cpuinfo";

export type LicenseReason =
	| "ok"
	| "missing"
	| "malformed"
	| "bad_signature"
	| "serial_mismatch"
	| "expired";

export type LicensePayload = {
	licenseId: string;
	client: string;
	piSerial: string;
	issuedAt: string;
	expiresAt: string;
};

export type LicenseInfo = {
	valid: boolean;
	reason: LicenseReason;
	client: string | null;
	piSerial: string | null;
	issuedAt: string | null;
	expiresAt: string | null;
	daysLeft: number | null;
	machineSerial: string | null;
	source: string | null;
};

/** Fields covered by the signature, in canonical order. */
const SIGNED_FIELDS: (keyof LicensePayload)[] = [
	"licenseId",
	"client",
	"piSerial",
	"issuedAt",
	"expiresAt",
];

/**
 * Canonical form fed to sign/verify: the signed fields only, key-sorted, no
 * whitespace. Any extra field in the file is ignored so it cannot alter the
 * bytes being verified.
 */
export function canonicalize(payload: LicensePayload): string {
	const ordered: Record<string, string> = {};
	for (const key of [...SIGNED_FIELDS].sort()) {
		ordered[key] = String(payload[key]);
	}
	return JSON.stringify(ordered);
}

/** Candidate license locations, highest precedence first. */
function licensePaths(): string[] {
	const paths: string[] = [];
	if (process.env.LICENSE_PATH) paths.push(process.env.LICENSE_PATH);
	paths.push(path.resolve("/license.json"));
	paths.push(path.join(process.cwd(), "license.json"));
	return paths;
}

/** Raspberry Pi hardware serial from /proc/cpuinfo; null off-Pi. */
export function readMachineSerial(): string | null {
	try {
		const cpuinfo = readFileSync(CPUINFO_PATH, "utf8");
		for (const line of cpuinfo.split("\n")) {
			const [rawKey, ...rest] = line.split(":");
			if (rawKey.trim().toLowerCase() !== "serial") continue;
			const serial = rest.join(":").trim();
			if (serial) return serial;
		}
		return null;
	} catch {
		return null;
	}
}

function daysBetween(from: number, to: number): number {
	return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function invalid(reason: LicenseReason, partial: Partial<LicenseInfo> = {}): LicenseInfo {
	return {
		valid: false,
		reason,
		client: null,
		piSerial: null,
		issuedAt: null,
		expiresAt: null,
		daysLeft: null,
		machineSerial: null,
		source: null,
		...partial,
	};
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0;
}

/**
 * Everything that cannot change while the process runs: the file contents, the
 * signature, and the device serial. Expiry is deliberately excluded — it is
 * re-checked on every call so a license can lapse under a long-running server.
 */
type VerifiedLicense =
	| { ok: true; payload: LicensePayload; expiresAtMs: number; machineSerial: string | null; source: string }
	| { ok: false; info: LicenseInfo };

function verifyFile(): VerifiedLicense {
	let raw: string | null = null;
	let source: string | null = null;

	for (const candidate of licensePaths()) {
		try {
			raw = readFileSync(candidate, "utf8");
			source = candidate;
			break;
		} catch {
			// try next candidate
		}
	}

	if (raw === null || source === null) return { ok: false, info: invalid("missing") };

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { ok: false, info: invalid("malformed", { source }) };
	}

	const signature = parsed.signature;
	if (!isNonEmptyString(signature)) {
		return { ok: false, info: invalid("malformed", { source }) };
	}
	for (const field of SIGNED_FIELDS) {
		if (!isNonEmptyString(parsed[field])) {
			return { ok: false, info: invalid("malformed", { source }) };
		}
	}

	const payload: LicensePayload = {
		licenseId: String(parsed.licenseId),
		client: String(parsed.client),
		piSerial: String(parsed.piSerial),
		issuedAt: String(parsed.issuedAt),
		expiresAt: String(parsed.expiresAt),
	};

	const expiresAtMs = new Date(payload.expiresAt).getTime();
	if (Number.isNaN(expiresAtMs)) {
		return { ok: false, info: invalid("malformed", { source }) };
	}

	let signatureOk = false;
	try {
		const verifier = createVerify("RSA-SHA256");
		verifier.update(canonicalize(payload), "utf8");
		verifier.end();
		signatureOk = verifier.verify(SOLETRONIX_PUBLIC_KEY, signature, "base64");
	} catch {
		signatureOk = false;
	}

	const machineSerial = readMachineSerial();

	if (!signatureOk) {
		// Nothing in an unverified file may be shown as fact.
		return {
			ok: false,
			info: invalid("bad_signature", {
				piSerial: payload.piSerial,
				issuedAt: payload.issuedAt,
				expiresAt: payload.expiresAt,
				daysLeft: daysBetween(Date.now(), expiresAtMs),
				machineSerial,
				source,
			}),
		};
	}

	if (payload.piSerial !== ANY_SERIAL && payload.piSerial !== machineSerial) {
		return {
			ok: false,
			info: invalid("serial_mismatch", {
				client: payload.client,
				piSerial: payload.piSerial,
				issuedAt: payload.issuedAt,
				expiresAt: payload.expiresAt,
				daysLeft: daysBetween(Date.now(), expiresAtMs),
				machineSerial,
				source,
			}),
		};
	}

	return { ok: true, payload, expiresAtMs, machineSerial, source };
}

let cached: VerifiedLicense | null = null;

/**
 * Full license state. The file read, signature check and serial check are done
 * once per process; expiry is evaluated on every call.
 */
export function getLicenseInfo(): LicenseInfo {
	if (cached === null) cached = verifyFile();
	if (!cached.ok) return cached.info;

	const { payload, expiresAtMs, machineSerial, source } = cached;
	const daysLeft = daysBetween(Date.now(), expiresAtMs);
	const known = {
		client: payload.client,
		piSerial: payload.piSerial,
		issuedAt: payload.issuedAt,
		expiresAt: payload.expiresAt,
		daysLeft,
		machineSerial,
		source,
	};

	if (expiresAtMs <= Date.now()) return invalid("expired", known);
	return { valid: true, reason: "ok", ...known };
}

/** True only when the file exists, verifies, matches this machine, and is unexpired. */
export function isLicenseValid(): boolean {
	return getLicenseInfo().valid;
}

/** Whole days until expiry; negative when past. null when no readable license. */
export function getDaysUntilExpiry(): number | null {
	return getLicenseInfo().daysLeft;
}

/** Drops the cache so the next read re-verifies the file. For tests and tooling. */
export function resetLicenseCache(): void {
	cached = null;
}
