// Turn query/form params into tool arguments using the item's JSON input_schema.
// Returns { args, errors, missing }. Unknown params are ignored.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fields(schema) {
  const props = (schema && schema.properties) || {};
  const required = new Set((schema && schema.required) || []);
  return Object.entries(props)
    .filter(([, p]) => !p["x-mcp-header"]) // header-mapped fields are set by Qatom, not the buyer
    .filter(([, p]) => !/^\s*leave this (out|empty|blank)\b/i.test(p.description || "")) // seller-internal fields
    .map(([name, p]) => ({ name, required: required.has(name), ...p }));
}

export function sensitive(field) {
  return field.format === "email" || /email|phone|address|password|secret|token/i.test(field.name);
}

export function buildArgs(schema, params) {
  const args = {};
  const errors = [];
  const missing = [];

  for (const f of fields(schema)) {
    let raw = params.get(f.name);
    if (raw == null) raw = "";
    raw = String(raw).trim();

    if (raw === "") {
      if (f.required) missing.push(f.name);
      continue;
    }
    const label = f.name;
    let v;
    const type = Array.isArray(f.type) ? f.type.find((t) => t !== "null") : f.type;

    if (type === "number" || type === "integer") {
      v = Number(raw);
      if (!Number.isFinite(v)) { errors.push(`${label} must be a number`); continue; }
      if (type === "integer" && !Number.isInteger(v)) { errors.push(`${label} must be a whole number`); continue; }
      if (f.minimum != null && v < f.minimum) errors.push(`${label} must be at least ${f.minimum}`);
      if (f.maximum != null && v > f.maximum) errors.push(`${label} must be at most ${f.maximum}`);
      if (f.exclusiveMinimum != null && v <= f.exclusiveMinimum) errors.push(`${label} must be more than ${f.exclusiveMinimum}`);
      if (f.exclusiveMaximum != null && v >= f.exclusiveMaximum) errors.push(`${label} must be less than ${f.exclusiveMaximum}`);
    } else if (type === "boolean") {
      const s = raw.toLowerCase();
      if (["true", "1", "yes", "on"].includes(s)) v = true;
      else if (["false", "0", "no", "off"].includes(s)) v = false;
      else { errors.push(`${label} must be true or false`); continue; }
    } else {
      v = raw;
      if (f.minLength != null && v.length < f.minLength) errors.push(`${label} must be at least ${f.minLength} characters`);
      if (f.maxLength != null && v.length > f.maxLength) errors.push(`${label} must be at most ${f.maxLength} characters`);
      if ((f.format === "email" || /(^|_)email$/i.test(f.name)) && !EMAIL_RE.test(v)) errors.push(`${label} must be an email address`);
      if (f.format === "date" && !DATE_RE.test(v)) errors.push(`${label} must be a date like 2026-10-21`);
      if (f.format === "uuid" && !UUID_RE.test(v)) errors.push(`${label} must be an ID like 123e4567-e89b-12d3-a456-426614174000`);
      if (f.pattern) {
        try { if (!new RegExp(f.pattern, "u").test(v)) errors.push(`${label} is not in the expected format`); } catch {}
      }
    }
    if (f.enum && !f.enum.includes(v)) { errors.push(`${label} must be one of: ${f.enum.join(", ")}`); continue; }
    args[f.name] = v;
  }
  return { args, errors, missing };
}
