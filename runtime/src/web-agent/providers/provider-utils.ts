/**
 * Shared utilities for browser providers (Browserbase, Steel).
 */

export async function safeReadJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractErrorMessage(
  body: Record<string, unknown> | null,
): string | undefined {
  if (!body) return undefined;
  const fields = [
    body.error,
    body.message,
    body.description,
    (body as any).details?.message,
  ];
  for (const field of fields) {
    const value = String(field || "").trim();
    if (value) return value;
  }
  return undefined;
}

export async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
