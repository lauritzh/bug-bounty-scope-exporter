import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};

const { attachCapture, buildCapture, canonicalizeScope, fingerprintScope } =
  await load("../lib/provenance.js");
const { toMarkdown } = await load("../lib/exporters.js");

const baseScope = () => ({
  platform: "hackerone",
  program: {
    name: "Example",
    handle: "example",
    url: "https://hackerone.com/example",
    website: "https://example.com",
    about: "Example program",
  },
  capture: {
    source: {
      method: "first-party-api",
      description: "HackerOne GraphQL API",
      endpoint: "https://hackerone.com/graphql",
    },
    platformUpdatedAt: {
      policy: "2026-09-01T10:00:00Z",
      scope: "2026-09-22T15:38:15+02:00",
      rewards: "",
    },
  },
  metadata: { resolvedReportCount: 12, submissionState: "open" },
  guidelines: { policy: "Test only listed assets.", updatedAt: "2026-09-01T10:00:00Z" },
  rewards: { currency: "USD", rows: [], updatedAt: "2026-09-01T10:00:00Z" },
  attachments: [],
  inScope: [
    { asset: "https://a.example.com", type: "URL", eligibleForBounty: true, maxSeverity: "Critical", instruction: "", reportCount: 3 },
    { asset: "https://b.example.com", type: "URL", eligibleForBounty: true, maxSeverity: "High", instruction: "", reportCount: 9 },
  ],
  outOfScope: [{ asset: "https://legacy.example.com", type: "URL", instruction: "" }],
  notes: [],
});

const fingerprintOf = async (scope) => (await fingerprintScope(scope)).overall;
const original = await fingerprintOf(baseScope());

// Volatile values must not move the fingerprint.
const volatile = baseScope();
volatile.metadata.resolvedReportCount = 4711;
volatile.guidelines.updatedAt = "2026-09-25T00:00:00Z";
volatile.rewards.updatedAt = "2026-09-25T00:00:00Z";
volatile.inScope[0].reportCount = 999;
volatile.capture.platformUpdatedAt.policy = "2026-09-25T00:00:00Z";
assert.equal(await fingerprintOf(volatile), original, "counters and timestamps must not change the fingerprint");

// Ordering and whitespace are presentation, not policy.
const reordered = baseScope();
reordered.inScope.reverse();
reordered.guidelines.policy = "Test only   listed\nassets.";
assert.equal(await fingerprintOf(reordered), original, "ordering and whitespace must not change the fingerprint");

// A field an adapter never fills must not change the fingerprint.
const emptied = baseScope();
emptied.guidelines.newPlatformField = "";
emptied.guidelines.anotherField = [];
assert.equal(await fingerprintOf(emptied), original, "empty fields must not change the fingerprint");

// Real policy-relevant edits must change the fingerprint and the right section.
const addedAsset = baseScope();
addedAsset.inScope.push({ asset: "https://new.example.com", type: "URL", eligibleForBounty: true, maxSeverity: "High", instruction: "" });
const addedPrint = await fingerprintScope(addedAsset);
const originalPrint = await fingerprintScope(baseScope());
assert.notEqual(addedPrint.overall, originalPrint.overall, "a new asset must change the fingerprint");
assert.notEqual(addedPrint.sections.assets, originalPrint.sections.assets);
assert.equal(addedPrint.sections.policy, originalPrint.sections.policy);
assert.deepEqual(addedPrint.counts, { inScope: 3, outOfScope: 1 });

const movedAsset = baseScope();
movedAsset.outOfScope.push(movedAsset.inScope.pop());
assert.notEqual(await fingerprintOf(movedAsset), original, "moving an asset out of scope must change the fingerprint");

const editedPolicy = baseScope();
editedPolicy.guidelines.policy = "Test only listed assets. No automated scanning.";
const editedPrint = await fingerprintScope(editedPolicy);
assert.notEqual(editedPrint.sections.policy, originalPrint.sections.policy);
assert.equal(editedPrint.sections.assets, originalPrint.sections.assets);

const editedReward = baseScope();
editedReward.rewards.currency = "EUR";
const rewardPrint = await fingerprintScope(editedReward);
assert.notEqual(rewardPrint.sections.rewards, originalPrint.sections.rewards);
assert.equal(rewardPrint.sections.assets, originalPrint.sections.assets);

// Canonical form must not leak volatile metadata.
const canonical = canonicalizeScope(baseScope());
assert.equal(JSON.stringify(canonical).includes("resolvedReportCount"), false);
assert.equal(JSON.stringify(canonical).includes("updatedAt"), false);

// Capture block.
const capture = await buildCapture(baseScope(), {
  sourceUrl: "https://user:secret@hackerone.com/example/policy_scopes?type=team#section",
  now: new Date("2026-09-25T08:00:00Z"),
});
assert.equal(capture.retrievedAt, "2026-09-25T08:00:00.000Z");
assert.equal(capture.retrievedFrom, "https://hackerone.com/example/policy_scopes");
assert.equal(capture.retrievedFrom.includes("secret"), false);
assert.equal(capture.programUrl, "https://hackerone.com/example");
assert.equal(capture.source.endpoint, "https://hackerone.com/graphql");
assert.equal(capture.platformUpdatedAt.policy, "2026-09-01T10:00:00.000Z");
assert.equal(capture.platformUpdatedAt.scope, "2026-09-22T13:38:15.000Z");
assert.equal("rewards" in capture.platformUpdatedAt, false);
assert.equal(capture.platformUpdatedAt.latest, "2026-09-22T13:38:15.000Z");
assert.equal(capture.fingerprint.overall, original);
assert.match(capture.fingerprint.overall, /^[0-9a-f]{64}$/);

// A capture with no source URL falls back to the canonical program URL.
const fallback = await buildCapture(baseScope(), { sourceUrl: "javascript:alert(1)" });
assert.equal(fallback.retrievedFrom, "https://hackerone.com/example");

// The capture block is placed directly after the program block.
const withCapture = attachCapture(baseScope(), capture);
assert.deepEqual(Object.keys(withCapture).slice(0, 3), ["platform", "program", "capture"]);
assert.equal(withCapture.capture, capture);

// Markdown rendering.
const markdown = toMarkdown(withCapture, { platformLabel: "HackerOne" });
assert.match(markdown, /Retrieved: 2026-09-25T08:00:00\.000Z from `https:\/\/hackerone\.com\/example\/policy_scopes`/);
assert.match(markdown, /## Snapshot/);
assert.match(markdown, /\| Retrieved from \| https:\/\/hackerone\.com\/example\/policy_scopes \|/);
assert.match(markdown, /\| Retrieved via \| HackerOne GraphQL API \(first-party-api\) \|/);
assert.match(markdown, /\| Retrieval endpoint \| https:\/\/hackerone\.com\/graphql \|/);
assert.match(markdown, /\| Latest platform change \| 2026-09-22T13:38:15\.000Z \|/);
assert.match(markdown, /\| Policy updated \| 2026-09-01T10:00:00\.000Z \|/);
assert.match(markdown, new RegExp(`\\| Content fingerprint \\(sha-256\\) \\| ${original} \\|`));
assert.match(markdown, /\| In-scope assets \| 2 \|/);
assert.match(markdown, /\| Out-of-scope assets \| 1 \|/);
assert.match(markdown, /Re-export and compare the fingerprints/);
assert.ok(markdown.indexOf("## Snapshot") < markdown.indexOf("## In Scope"));

// Query strings never identify a program page and may carry session material.
const queryCapture = await buildCapture(baseScope(), {
  sourceUrl: "https://hackerone.com/example?token=abc123&session=deadbeef",
});
assert.equal(queryCapture.retrievedFrom, "https://hackerone.com/example");

// A retrieval URL is page-influenced, so it must not inject Markdown.
const injected = baseScope();
const injectedCapture = await buildCapture(injected, { sourceUrl: "https://hackerone.com/ex[CLICK](https://evil.example)`x`*b*" });
const injectedMarkdown = toMarkdown(attachCapture(injected, injectedCapture), { platformLabel: "HackerOne" });
const retrievedLine = injectedMarkdown.split("\n").find((line) => line.startsWith("Retrieved:"));
// Everything page-influenced is inside a code span, where link, emphasis, and
// code syntax are inert; nothing attacker-controlled reaches the line body.
const spanStart = retrievedLine.indexOf("`");
assert.notEqual(spanStart, -1, `no code span in: ${retrievedLine}`);
const beforeSpan = retrievedLine.slice(0, spanStart);
const codeSpan = retrievedLine.slice(spanStart);
assert.equal(beforeSpan, "Retrieved: 2026-09-25T08:00:00.000Z from ".replace("2026-09-25T08:00:00.000Z", injectedCapture.retrievedAt));
assert.equal(/[[\]()*_`]/.test(beforeSpan), false, `unescaped Markdown in: ${beforeSpan}`);
assert.match(codeSpan, /^(`+) ?https:\/\/hackerone\.com\/ex.* ?\1$/);
assert.ok(codeSpan.includes("[CLICK]"), "the raw URL is preserved, just neutralized");

// An unparseable platform timestamp must be dropped, not shown as a date.
const bogus = baseScope();
bogus.capture.platformUpdatedAt.policy = "not a date at all";
const bogusCapture = await buildCapture(bogus, { sourceUrl: bogus.program.url });
assert.equal("policy" in bogusCapture.platformUpdatedAt, false);
assert.equal(toMarkdown(attachCapture(bogus, bogusCapture)).includes("not a date at all"), false);

// A partial export must say so.
const partial = baseScope();
const partialCapture = await buildCapture(partial, { sourceUrl: partial.program.url });
partialCapture.source = { method: "rendered-page", description: "Scope table rendered on the program page", complete: false };
assert.match(toMarkdown(attachCapture(partial, partialCapture)), /\| Coverage \| Partial — see notes \|/);

// A degraded capture must never present a comparable digest for what it could
// not read: two partial exports of a program whose policy changed in between
// must not compare as unchanged.
const degraded = () => ({
  ...baseScope(),
  program: { name: "Example", handle: "example", url: "https://hackerone.com/example", website: "", about: "" },
  metadata: {},
  guidelines: {},
  rewards: {},
  attachments: [],
});
const degradedPrint = await fingerprintScope(degraded(), { sourceComplete: false });
assert.equal(degradedPrint.sections.policy, "", "an uncaptured section must not carry a digest");
assert.equal(degradedPrint.coverage.complete, false);
assert.deepEqual(degradedPrint.coverage.missing, ["policy", "rewards", "program"]);
assert.equal((await fingerprintScope(baseScope())).coverage.complete, true);

const degradedCapture = await buildCapture(degraded(), { sourceUrl: "https://hackerone.com/example" });
degradedCapture.source = { method: "rendered-page", complete: false };
const degradedMarkdown = toMarkdown(attachCapture(degraded(), {
  ...degradedCapture,
  fingerprint: degradedPrint,
}));
assert.match(degradedMarkdown, /\*\*This snapshot is incomplete\.\*\*/);
assert.match(degradedMarkdown, /does not contain the policy text and attachments/);
assert.match(degradedMarkdown, /an unchanged fingerprint does not rule out a change/);
assert.equal(degradedMarkdown.includes("An unchanged overall fingerprint means"), false);
assert.match(degradedMarkdown, /\| Policy fingerprint \| Not captured \|/);

// Policy attachments are policy: replacing the file must change the fingerprint.
const replacedAttachment = baseScope();
replacedAttachment.attachments = [{ section: "", fileName: "rules.pdf", fileSize: 100, contentType: "application/pdf" }];
const withAttachment = await fingerprintScope(replacedAttachment);
assert.notEqual(withAttachment.sections.policy, originalPrint.sections.policy);
replacedAttachment.attachments = [{ section: "", fileName: "rules-v2.pdf", fileSize: 240, contentType: "application/pdf" }];
assert.notEqual((await fingerprintScope(replacedAttachment)).sections.policy, withAttachment.sections.policy);

// Program state that governs testing is covered; informational counters are not.
const paused = baseScope();
paused.metadata.submissionState = "paused";
const pausedPrint = await fingerprintScope(paused);
assert.notEqual(pausedPrint.sections.program, originalPrint.sections.program);
assert.notEqual(pausedPrint.overall, originalPrint.overall);
assert.equal(pausedPrint.sections.assets, originalPrint.sections.assets);

const busier = baseScope();
busier.metadata.resolvedReportCount = 9_999;
assert.equal((await fingerprintScope(busier)).sections.program, originalPrint.sections.program);

// A page-supplied `__proto__` key must not silently drop content.
const polluted = baseScope();
polluted.guidelines = JSON.parse('{"policy":"keep","__proto__":{"hidden":"first"}}');
const pollutedPrint = await fingerprintScope(polluted);
assert.equal(JSON.stringify(canonicalizeScope(polluted)).includes("first"), true, "content under a __proto__ key must be hashed");
polluted.guidelines = JSON.parse('{"policy":"keep","__proto__":{"hidden":"second"}}');
assert.notEqual((await fingerprintScope(polluted)).sections.policy, pollutedPrint.sections.policy);
assert.equal(Object.prototype.hidden, undefined);

// Deep nesting must not take the export down.
const deep = baseScope();
let node = deep.guidelines;
for (let level = 0; level < 20_000; level += 1) {
  node.child = {};
  node = node.child;
}
node.policy = "deep";
assert.match((await fingerprintScope(deep)).overall, /^[0-9a-f]{64}$/);

// The Snapshot section is optional; the header line always states the origin.
const withoutSnapshot = toMarkdown(withCapture, { platformLabel: "HackerOne", snapshot: false });
assert.match(withoutSnapshot, /Retrieved: 2026-09-25T08:00:00\.000Z from `https:\/\/hackerone\.com\/example\/policy_scopes`/);
assert.equal(withoutSnapshot.includes("## Snapshot"), false);
assert.equal(withoutSnapshot.includes("Content fingerprint"), false);
assert.equal(withoutSnapshot.includes("Re-export and compare the fingerprints"), false);
assert.match(withoutSnapshot, /## In Scope/);
assert.match(withoutSnapshot, /## Program Metadata/);
// Without the Snapshot section, metadata keeps the timestamps it would otherwise duplicate.
const timestamped = baseScope();
timestamped.metadata.lastPolicyChangeAt = "2026-09-01T10:00:00Z";
const timestampedScope = attachCapture(timestamped, await buildCapture(timestamped, { sourceUrl: timestamped.program.url }));
assert.equal(toMarkdown(timestampedScope).includes("| Last Policy Change At |"), false);
assert.match(toMarkdown(timestampedScope, { snapshot: false }), /\| Last Policy Change At \| 2026-09-01T10:00:00Z \|/);

// Exports without a capture block still render.
const withoutCapture = baseScope();
delete withoutCapture.capture;
const plain = toMarkdown(withoutCapture, { platformLabel: "HackerOne" });
assert.equal(plain.includes("## Snapshot"), false);
assert.match(plain, /## In Scope/);

console.log("Provenance, freshness, fingerprint, and snapshot-rendering tests passed.");
