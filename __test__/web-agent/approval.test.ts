import { describe, expect, it } from "vitest";
import {
  computeActionDigest,
  signApprovalToken,
  verifyApprovalToken,
} from "../../runtime/src/web-agent/approval.js";
import type { WebAction } from "../../runtime/src/web-agent/contracts.js";

describe("computeActionDigest", () => {
  it("returns deterministic SHA-256 hex", () => {
    const action: WebAction = { type: "click", target: { text: "Buy" } };
    const d1 = computeActionDigest(action);
    const d2 = computeActionDigest(action);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is key-order stable", () => {
    const a: WebAction = {
      type: "click",
      target: { text: "Buy", css: "#btn" },
    };
    const b: WebAction = {
      type: "click",
      target: { css: "#btn", text: "Buy" },
    };
    expect(computeActionDigest(a)).toBe(computeActionDigest(b));
  });

  it("differs for different actions", () => {
    const a: WebAction = { type: "click", target: { text: "Buy" } };
    const b: WebAction = { type: "click", target: { text: "Cancel" } };
    expect(computeActionDigest(a)).not.toBe(computeActionDigest(b));
  });
});

describe("signApprovalToken / verifyApprovalToken", () => {
  const sessionId = "session-123";
  const digest = "abc123";
  const secret = "test-secret";

  it("sign returns base64url string", () => {
    const token = signApprovalToken(sessionId, digest, secret);
    expect(token).toBeTruthy();
    expect(token).not.toMatch(/[+/=]/); // base64url has no +, /, =
  });

  it("verify accepts valid token", () => {
    const token = signApprovalToken(sessionId, digest, secret);
    expect(verifyApprovalToken(sessionId, digest, token, secret)).toBe(true);
  });

  it("verify rejects tampered token", () => {
    const token = signApprovalToken(sessionId, digest, secret);
    expect(verifyApprovalToken(sessionId, digest, token + "x", secret)).toBe(
      false,
    );
  });

  it("verify rejects wrong session", () => {
    const token = signApprovalToken(sessionId, digest, secret);
    expect(verifyApprovalToken("other", digest, token, secret)).toBe(false);
  });

  it("verify rejects wrong digest", () => {
    const token = signApprovalToken(sessionId, digest, secret);
    expect(verifyApprovalToken(sessionId, "other", token, secret)).toBe(false);
  });

  it("custom secret isolates tokens", () => {
    const token = signApprovalToken(sessionId, digest, "secret-a");
    expect(verifyApprovalToken(sessionId, digest, token, "secret-b")).toBe(
      false,
    );
  });
});
