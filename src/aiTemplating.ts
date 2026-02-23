export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  const t = String(template || "");
  return t.replace(/\{\{\s*([\w.\-À-ÿ]+)\s*\}\}/g, (_m, key) => {
    const k = String(key || "").trim();
    return vars[k] ?? "";
  });
}
