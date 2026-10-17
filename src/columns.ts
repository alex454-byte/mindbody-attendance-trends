// Find the columns we need by header name. Mindbody's column names vary by report version, so each role has a
// list of synonyms, best first. Only header names ever leave this module, never cell values.

export type Role = "client_name" | "first_name" | "last_name" | "client_id" | "visit_date" | "visit_time" |
  "class_name" | "status" | "location";

export const ROLES: Role[] = ["client_name", "first_name", "last_name", "client_id", "visit_date", "visit_time",
  "class_name", "status", "location"];

/**
 * Synonyms per role, normalized (lowercase, letters and digits only), in tiers: a header in an earlier tier wins
 * over one in a later tier; two different headers in the same best tier are ambiguous and the user picks.
 */
const SYNONYMS: Record<Role, string[][]> = {
  client_name: [["clientname", "membername", "customername", "client", "member", "customer"], ["name", "fullname", "clientfullname"]],
  first_name: [["clientfirstname", "firstname"], ["first"]],
  last_name: [["clientlastname", "lastname"], ["last", "surname"]],
  client_id: [["clientid", "memberid", "customerid", "uniqueid", "clientuniqueid"], ["id", "clientnumber", "rssid"]],
  visit_date: [["visitdate", "classdate", "servicedate", "appointmentdate", "visitdatetime"], ["date", "datetime", "startdate"]],
  visit_time: [["visittime", "classtime", "appointmenttime"], ["time", "starttime"]],
  class_name: [["classname", "class", "servicename", "classappointment", "visittype"],
    ["service", "appointment", "session", "description", "serviceitem"]],
  status: [["status", "visitstatus", "attendancestatus", "signinstatus"], ["attendance", "signedin", "checkedin"]],
  location: [["location", "locationname", "visitlocation"], ["site", "sitename", "facility", "facilityname"]],
};

export const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

export type Mapping = Partial<Record<Role, string>>;

export interface Detection {
  mapping: Mapping;
  /** Roles where two or more headers matched equally well. */
  ambiguous: Partial<Record<Role, string[]>>;
  /** True when we have a name (or first + last, or an ID) and a date. */
  usable: boolean;
}

function rank(header: string, role: Role): number {
  const key = normalizeHeader(header);
  const tier = SYNONYMS[role].findIndex((names) => names.includes(key));
  return tier === -1 ? Infinity : tier;
}

/** How many headers in a row look like attendance headers; used to find the header row. */
export function headerScore(row: string[]): number {
  return row.filter((cell) => ROLES.some((role) => rank(cell, role) !== Infinity)).length;
}

export function detectColumns(headers: string[], overrides: Mapping = {}): Detection {
  const mapping: Mapping = {};
  const ambiguous: Partial<Record<Role, string[]>> = {};
  const taken = new Set<string>();
  for (const [role, header] of Object.entries(overrides) as [Role, string][]) {
    if (header && headers.includes(header)) { mapping[role] = header; taken.add(header); }
  }
  for (const role of ROLES) {
    if (mapping[role]) continue;
    const scored = headers.filter((h) => h && !taken.has(h)).map((h) => ({ h, r: rank(h, role) })).filter((x) => x.r !== Infinity);
    if (!scored.length) continue;
    const best = Math.min(...scored.map((x) => x.r));
    const top = scored.filter((x) => x.r === best).map((x) => x.h);
    if (top.length > 1) { ambiguous[role] = top; continue; }
    mapping[role] = top[0]!;
    taken.add(top[0]!);
  }
  // "Name" next to "First Name"/"Last Name" is fine; the split columns are used together.
  const hasName = Boolean(mapping.client_name || (mapping.first_name && mapping.last_name) || mapping.client_id);
  return { mapping, ambiguous, usable: hasName && Boolean(mapping.visit_date) };
}

/** Membership and hold exports only need someone to match on. */
export function detectPersonColumns(headers: string[], overrides: Mapping = {}): Detection {
  const d = detectColumns(headers, overrides);
  return { ...d, usable: Boolean(d.mapping.client_name || (d.mapping.first_name && d.mapping.last_name) || d.mapping.client_id) };
}

// Status values. Anything not recognized as attended is not counted (and is counted in `unrecognizedStatusRows`).
const ATTENDED = /^(signed ?in|sign ?in|attended|checked ?in|check ?in|completed?|visited|present|yes|y|true|arrived|confirmed)$/;
const MISSED = /(no.?show|late.?cancel|cancel|absent|missed|^no$|^n$|^false$)/;

export type StatusKind = "attended" | "missed" | "unknown";

export function statusKind(value: string): StatusKind {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (MISSED.test(v)) return "missed";
  if (ATTENDED.test(v)) return "attended";
  return "unknown";
}
