import type { Context } from "hono";

type ParsePositiveIntOptions = {
  defaultValue: number;
  min?: number;
  max: number;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(c: Context): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!isPlainObject(body)) {
    return c.json({ error: "JSON body must be an object" }, 400);
  }

  return body;
}

export function parseBoundedPositiveInt(
  value: string | undefined,
  fieldName: string,
  options: ParsePositiveIntOptions,
): { ok: true; value: number } | { ok: false; error: string } {
  const { defaultValue, min = 1, max } = options;

  if (value === undefined) {
    return { ok: true, value: defaultValue };
  }

  if (!/^\d+$/.test(value)) {
    return { ok: false, error: `${fieldName} must be an integer between ${min} and ${max}` };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, error: `${fieldName} must be an integer between ${min} and ${max}` };
  }

  return { ok: true, value: parsed };
}

export function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
