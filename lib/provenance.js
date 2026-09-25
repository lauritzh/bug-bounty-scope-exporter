// Snapshot provenance: where a scope export came from, how fresh it is, and a
// content fingerprint that only changes when policy-relevant content changes.
//
// The fingerprint is deliberately not a hash of the page or of the raw API
// payload. Those carry request identifiers, counters, rendering state, and
// session-specific values that differ on every load, so they report changes
// that never affected the policy. Instead the scope is reduced to a canonical
// form — volatile fields removed, whitespace collapsed, empty values dropped,
// collections sorted — and that form is hashed per section.

export const FINGERPRINT_VERSION = 1;
export const FINGERPRINT_ALGORITHM = "sha-256";

// Values that change without the policy changing. They are excluded from every
// canonical form, at any nesting depth.
const VOLATILE_KEYS = new Set([
  "acceptedSubmissionCount",
  "activeHuntersCount",
  "averagePayout",
  "computedAt",
  "createdAt",
  "hasHistory",
  "hasPendingVersion",
  "hasUpdates",
  "lastPolicyChangeAt",
  "lastScopeChangeAt",
  "lastUpdatedAt",
  "logoId",
  "programId",
  "programMetrics",
  "reportCount",
  "reportsCount",
  "reportsImportedCount",
  "resolvedReportCount",
  "smartRewardsStartAt",
  "stats",
  "submissionCount",
  "termsRequiredAt",
  "totalPayout",
  "updatedAt",
]);

// Program state that governs whether and how testing is allowed. Everything
// else in `metadata` is informational and stays out of the fingerprint.
const PROGRAM_STATE_KEYS = new Set([
  "allowsBountySplitting",
  "allowsDisclosureAssistance",
  "allowsPrivateDisclosure",
  "allowsCollaboration",
  "archived",
  "awardsReputation",
  "confidentiality",
  "disabled",
  "industry",
  "offersBounties",
  "offersGifts",
  "offersThanks",
  "onlyClearedHackers",
  "onlyIdVerifiedHackers",
  "public",
  "reportCollaborationActive",
  "skipsTriage",
  "state",
  "status",
  "submissionRequirementsEnabled",
  "submissionState",
  "triageActive",
  "triaged",
  "type",
  "vulnerabilityDisclosureProgram",
]);

// Guards against a hostile or pathological nesting depth. Adapters normalize
// into fixed shapes far shallower than this.
const MAX_DEPTH = 64;

function normalizeText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function byCanonicalOrder(a, b) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Reduces a value to its policy-relevant core. Returns null for anything that
// carries no content, so an adapter adding a field it never fills does not move
// the fingerprint.
function canonicalValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return normalizeText(value) || null;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item, depth + 1)).filter((item) => item !== null);
    // Ordering inside a platform's own collections is presentation, not policy.
    items.sort(byCanonicalOrder);
    return items.length > 0 ? items : null;
  }
  if (typeof value !== "object") return null;

  // A null prototype keeps a `__proto__` key an ordinary own property instead
  // of a setter call, so page-supplied keys can never drop content silently.
  const result = Object.create(null);
  let size = 0;
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    const child = canonicalValue(value[key], depth + 1);
    if (child !== null) {
      result[key] = child;
      size += 1;
    }
  }
  return size > 0 ? result : null;
}

function canonicalAssets(entries, bucket) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => canonicalValue({
      bucket,
      asset: entry?.asset,
      type: entry?.type || entry?.assetTypeId,
      group: entry?.group,
      tier: entry?.bountyTier || entry?.bountyTierId,
      rewardGrid: entry?.rewardGrid,
      eligibleForBounty: entry?.eligibleForBounty,
      maxSeverity: entry?.maxSeverity,
      requiredSkills: entry?.requiredSkills,
      source: entry?.source,
      instruction: entry?.instruction,
    }))
    .filter((entry) => entry !== null)
    .sort(byCanonicalOrder);
}

// Policy attachments are policy: a program can rewrite its rules by replacing
// the file the policy points at.
function canonicalAttachments(attachments) {
  if (!Array.isArray(attachments)) return null;
  const items = attachments
    .map((attachment) => canonicalValue({
      section: attachment?.section,
      fileName: attachment?.fileName,
      fileSize: attachment?.fileSize,
      contentType: attachment?.contentType,
    }))
    .filter((attachment) => attachment !== null)
    .sort(byCanonicalOrder);
  return items.length > 0 ? items : null;
}

function canonicalProgramState(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const state = {};
  for (const key of Object.keys(metadata)) {
    if (PROGRAM_STATE_KEYS.has(key)) state[key] = metadata[key];
  }
  return canonicalValue(state);
}

export function canonicalizeScope(scope) {
  return {
    assets: [
      ...canonicalAssets(scope?.inScope, "in-scope"),
      ...canonicalAssets(scope?.outOfScope, "out-of-scope"),
    ],
    policy: canonicalValue({
      about: scope?.program?.about,
      website: scope?.program?.website,
      guidelines: scope?.guidelines,
      attachments: canonicalAttachments(scope?.attachments),
    }),
    rewards: canonicalValue(scope?.rewards),
    program: canonicalProgramState(scope?.metadata),
  };
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A section that holds no content gets no digest. Hashing "nothing" would give
// every degraded export the same value, so two partial captures of a program
// whose policy changed in between would compare as unchanged.
async function sectionDigest(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.length === 0) return "";
  return digest(value);
}

// Sections a complete capture always fills. `rewards` and `program` can be
// legitimately empty, so their absence is reported but does not mean degraded.
const REQUIRED_SECTIONS = ["assets", "policy"];

export async function fingerprintScope(scope, { sourceComplete = true } = {}) {
  const canonical = canonicalizeScope(scope);
  const [assets, policy, rewards, program] = await Promise.all([
    sectionDigest(canonical.assets),
    sectionDigest(canonical.policy),
    sectionDigest(canonical.rewards),
    sectionDigest(canonical.program),
  ]);
  const sections = { assets, policy, rewards, program };
  const missing = Object.entries(sections)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const overall = await digest([FINGERPRINT_VERSION, assets, policy, rewards, program]);

  return {
    version: FINGERPRINT_VERSION,
    algorithm: FINGERPRINT_ALGORITHM,
    overall,
    sections,
    coverage: {
      complete: sourceComplete !== false && REQUIRED_SECTIONS.every((section) => sections[section]),
      missing,
    },
    counts: {
      inScope: Array.isArray(scope?.inScope) ? scope.inScope.length : 0,
      outOfScope: Array.isArray(scope?.outOfScope) ? scope.outOfScope.length : 0,
    },
  };
}

// Keeps only the parts of a URL that identify the page. Credentials, query, and
// fragment are dropped: none of them identify a program, and all three can
// carry session material on a page the extension does not control.
function safeUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

// Platform timestamps can come from page-controlled state. A value that is not
// a date is dropped rather than shown under a "... updated" label a reader
// would otherwise trust.
function isoTimestamp(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizePlatformUpdates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, timestamp] of Object.entries(value)) {
    const normalized = isoTimestamp(timestamp);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function latestTimestamp(updates) {
  let latest = "";
  let latestValue = -Infinity;
  for (const timestamp of Object.values(updates)) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed) && parsed > latestValue) {
      latestValue = parsed;
      latest = timestamp;
    }
  }
  return latest;
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = {};
  const method = normalizeText(value.method ?? "");
  const description = normalizeText(value.description ?? "");
  const endpoint = safeUrl(value.endpoint);
  if (method) source.method = method;
  if (description) source.description = description;
  if (endpoint) source.endpoint = endpoint;
  if (value.complete === false) source.complete = false;
  return Object.keys(source).length > 0 ? source : null;
}

/**
 * Completes the capture block an adapter started. The adapter knows how it
 * reached the data and which timestamps the platform reports; the caller knows
 * the page the export was taken from and when.
 */
export async function buildCapture(scope, { sourceUrl = "", now = new Date() } = {}) {
  const provided = scope?.capture && typeof scope.capture === "object" ? scope.capture : {};
  const platformUpdatedAt = normalizePlatformUpdates(provided.platformUpdatedAt);
  const latest = latestTimestamp(platformUpdatedAt);
  if (latest) platformUpdatedAt.latest = latest;

  const source = normalizeSource(provided.source);
  return {
    retrievedAt: now.toISOString(),
    retrievedFrom: safeUrl(sourceUrl) || safeUrl(scope?.program?.url),
    programUrl: safeUrl(scope?.program?.url),
    source,
    platformUpdatedAt,
    fingerprint: await fingerprintScope(scope, { sourceComplete: source?.complete !== false }),
  };
}

/** Returns a copy of the scope with the capture block placed after `program`. */
export function attachCapture(scope, capture) {
  const { platform, program, capture: _ignored, ...rest } = scope;
  return { platform, program, capture, ...rest };
}
