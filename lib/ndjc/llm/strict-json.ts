export function parseStrictJson(raw: string): { ok: true; data: any } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  try {
    const data = JSON.parse(trimmed);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: `JSON parse failed: ${e.message}` };
  }
}
