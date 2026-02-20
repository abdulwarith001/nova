import { createHash, createHmac } from "crypto";
import type { WebAction } from "./contracts.js";

const DEFAULT_SECRET = "nova-web-agent-local-secret";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${pairs
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeActionDigest(action: WebAction): string {
  return createHash("sha256")
    .update(stableStringify(action))
    .digest("hex");
}

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function signApprovalToken(
  sessionId: string,
  actionDigest: string,
  secret = process.env.NOVA_WEB_CONFIRM_SECRET || DEFAULT_SECRET,
): string {
  const payload = `${sessionId}:${actionDigest}`;
  return toBase64Url(createHmac("sha256", secret).update(payload).digest());
}

export function verifyApprovalToken(
  sessionId: string,
  actionDigest: string,
  token: string,
  secret = process.env.NOVA_WEB_CONFIRM_SECRET || DEFAULT_SECRET,
): boolean {
  const expected = signApprovalToken(sessionId, actionDigest, secret);
  return token === expected;
}
