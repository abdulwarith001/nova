import { describe, expect, it } from "vitest";
import {
  resolveWebBackend,
  resolveWebBackendFallback,
  resolveWebHeadless,
  resolveWebProfileId,
} from "../../runtime/src/worker.js";

describe("resolveWebHeadless", () => {
  it("defaults to true when env and params are unset", () => {
    expect(resolveWebHeadless({}, "")).toBe(true);
  });

  it("uses NOVA_WEB_HEADLESS when provided", () => {
    expect(resolveWebHeadless({}, "false")).toBe(false);
    expect(resolveWebHeadless({}, "true")).toBe(true);
  });

  it("prefers explicit tool param over env", () => {
    expect(resolveWebHeadless({ headless: true }, "false")).toBe(true);
    expect(resolveWebHeadless({ headless: false }, "true")).toBe(false);
    expect(resolveWebHeadless({ headless: "false" }, "true")).toBe(false);
  });
});

describe("resolveWebProfileId", () => {
  it("uses explicit profileId param when provided", () => {
    expect(
      resolveWebProfileId(
        { profileId: "custom-profile" },
        "telegram:123",
        "assigned-profile",
        "env-profile",
      ),
    ).toBe("custom-profile");
  });

  it("uses assigned profile when explicit param is absent", () => {
    expect(
      resolveWebProfileId({}, "telegram:123", "assigned-profile", "env-profile"),
    ).toBe("assigned-profile");
  });

  it("uses env default profile when no explicit or assigned profile exists", () => {
    expect(resolveWebProfileId({}, "telegram:123", undefined, "env-profile")).toBe(
      "env-profile",
    );
  });

  it("falls back to sessionId when no profile is configured", () => {
    expect(resolveWebProfileId({}, "telegram:123", undefined, "")).toBe(
      "telegram:123",
    );
  });
});

describe("resolveWebBackend", () => {
  it("defaults to auto", () => {
    expect(resolveWebBackend({}, "")).toBe("auto");
  });

  it("uses env backend when valid", () => {
    expect(resolveWebBackend({}, "browserbase")).toBe("browserbase");
    expect(resolveWebBackend({}, "steel")).toBe("steel");
    expect(resolveWebBackend({}, "local")).toBe("local");
  });

  it("prefers explicit tool param", () => {
    expect(resolveWebBackend({ backend: "local" }, "browserbase")).toBe("local");
    expect(resolveWebBackend({ backend: "steel" }, "local")).toBe("steel");
    expect(resolveWebBackend({ backend: "browserbase" }, "local")).toBe("browserbase");
    expect(resolveWebBackend({ backend: "auto" }, "local")).toBe("auto");
  });
});

describe("resolveWebBackendFallback", () => {
  it("defaults to true", () => {
    expect(resolveWebBackendFallback({}, "")).toBe(true);
  });

  it("uses env flag when provided", () => {
    expect(resolveWebBackendFallback({}, "false")).toBe(false);
    expect(resolveWebBackendFallback({}, "true")).toBe(true);
  });

  it("prefers explicit param over env", () => {
    expect(resolveWebBackendFallback({ fallbackOnError: false }, "true")).toBe(false);
    expect(resolveWebBackendFallback({ fallbackOnError: true }, "false")).toBe(true);
  });
});
