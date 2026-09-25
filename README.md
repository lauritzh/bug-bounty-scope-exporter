# Bug Bounty Scope Exporter

This Chromium extension extracts the scope of a supported bug bounty program and makes it available as compact Markdown or normalized JSON. The result can be copied to the clipboard or saved locally for use in security research notes and tooling.

## Features

* Mark supported program pages with a `!` badge on the extension's toolbar icon.
* Record snapshot provenance with every export: when the scope was retrieved, the exact page URL it was retrieved from, how it was retrieved, and the update timestamps the platform itself reports.
* Detect scope and policy drift with a content fingerprint that changes only when policy-relevant content changes.
* Export program metadata, policy and guideline text, scope declarations and exclusions, reward tables, and non-sensitive attachment metadata.
* Extract in-scope and out-of-scope assets, including asset type, group, bounty tier and eligibility, maximum severity, required skills, source, and asset-specific instructions when the platform provides them.
* Preview, copy, or save the result as Markdown or JSON, with the Snapshot section switchable off for a leaner document.
* Keep platform-specific behavior in small adapters so more bug bounty platforms can be added without changing the popup or exporters.

## Installation

*Always keep in mind that browser extensions can access sensitive data on pages where they are activated. Review the source and permissions before installing an unpacked extension, especially in a browser used for authenticated security research.*

A Chrome Web Store release is planned, but is not available yet.

Steps to install manually:

1. Clone this repository via `git clone https://github.com/lauritzh/bug-bounty-scope-exporter`.
2. Navigate to `chrome://extensions/` in Chrome or another Chromium-based browser.
3. Enable *Developer mode*.
4. Select *Load unpacked* and choose the cloned `/bug-bounty-scope-exporter` directory.
5. Open a supported program page and select **Bug Bounty Scope Exporter** from the browser toolbar.

## Usage

1. Visit a supported bug bounty program page.
2. Open the extension. Scope extraction starts automatically.
3. Choose **Markdown** or **JSON**, and whether the Markdown export includes the **Snapshot section**.
4. Select **Copy** to place the preview on the clipboard or **Save** to download it.

The extension never saves extracted scope automatically.

## Snapshot Freshness and Change Detection

A saved scope is a point-in-time copy of a document the program owner can edit at any time. Every export therefore carries a `Snapshot` section in Markdown and a `capture` object in JSON:

* `retrievedAt` — when the export was taken, in UTC.
* `retrievedFrom` — the exact program page URL the export was taken from, with credentials and fragment removed.
* `programUrl` — the canonical program URL, which may differ from the page that was open.
* `source` — how the data was obtained: structured data embedded in the page, a first-party API including the endpoint that was called, or the rendered page as a partial fallback.
* `platformUpdatedAt` — the change timestamps the platform publishes for policy, scope, assets, rewards, and declarations, plus the most recent of them as `latest`.
* `fingerprint` — a SHA-256 content fingerprint as one overall value and one value per section, with in-scope and out-of-scope asset counts and a `coverage` flag describing how complete the capture was.

Re-export a program and compare the fingerprints against an earlier snapshot to see whether anything relevant changed, and which section changed. The fingerprint has four sections:

* `assets` — every in-scope and out-of-scope entry with its type, group, bounty tier, bounty eligibility, maximum severity, required skills, source, and instructions.
* `policy` — the program description, the policy, scope, FAQ, severity-assessment and rules-of-engagement text, the testing requirements and safe-harbor declarations, and the policy attachments, because a program can rewrite its rules by replacing the file its policy points at.
* `rewards` — reward guidance, reward tables, and bounty tiers.
* `program` — the program state that governs whether and how testing is allowed, such as submission state, confidentiality, and researcher requirements.

Retrieval can be partial: a platform API may be unreachable and only the rendered page readable, or a program may expose less to an unauthenticated visitor. A section that was not captured gets no digest at all, is shown as `Not captured`, and the export says so. This matters because hashing an uncaptured section would give every degraded export the same value, so two partial snapshots of a program whose policy changed in between would compare as unchanged — the exact false negative the fingerprint exists to prevent. An export only claims that unchanged content means unchanged policy when the capture was complete.

The fingerprint is deliberately not a hash of the page or of the raw API response. Those carry request identifiers, counters, rendering state, and session-specific values that differ on every load, so they report changes that never affected the policy and quickly train the reader to ignore them. Instead the scope is reduced to a canonical form before hashing:

* Volatile fields are removed, including update and creation timestamps, report and submission counts, payout statistics, program metrics, and internal identifiers.
* Text is whitespace-normalized, so reflowed or reindented policy text does not count as a change.
* Empty values are dropped, so a platform field that is never filled does not move the fingerprint.
* Collections are sorted, so a platform reordering its own assets or lists does not count as a change.
* Informational program metadata, such as statistics, report counters, and payout averages, is excluded entirely.

What does move the fingerprint is what matters for authorization to test: an added, removed, or re-scoped asset, a changed asset type, bounty tier, bounty eligibility, maximum severity, required skills, or asset instruction, edited policy, scope, FAQ, severity-assessment or rules-of-engagement text, changed testing requirements or safe-harbor declarations, a replaced policy attachment, a paused or restricted program, and changed reward tables or tiers.

Platform timestamps and the fingerprint answer different questions and are both exported: a platform can change a policy without updating a timestamp, and can update a timestamp without changing anything relevant.

The **Snapshot section** switch in the popup controls how much of this appears in a Markdown export. Enabled, the full `## Snapshot` section is rendered. Disabled, the section is dropped and only the `Retrieved:` line in the document header remains, so an export still states when it was taken and from which URL. The switch does not apply to JSON, where `capture` is the machine-readable provenance record and is always included.

## Supported Platforms

* **HackerOne** program pages
* **Intigriti** public and researcher program detail pages
* **YesWeHack (work in progress)** public program pages only; private programs are not supported yet

The HackerOne adapter recognizes program routes by hostname, path, and the optional `type=team` query parameter. It first uses complete structured data already present on the page. If that is unavailable, it makes a read-only request to HackerOne's same-origin GraphQL endpoint using the browser's existing authenticated session. Visible scope-table parsing is used only as a fallback and is explicitly marked as a partial export.

Exports include the complete available program policy, scope description, declarative-policy fields, safe-harbor status, platform and scope exclusions, program restrictions, update timestamps, scope assets and instructions, reward guidance, reward rows, and policy attachment names and types. Signed or expiring attachment URLs are deliberately excluded because they may contain authentication material.

The Intigriti adapter recognizes both `/programs/<company>/<program>/detail` and `/researcher/programs/<company>/<program>/detail` routes. It reads Intigriti's first-party program endpoint and exports the current description, rules of engagement, in-scope and out-of-scope guidance, FAQ, severity assessment, testing requirements, safe-harbor declaration, assets and groups, bounty tiers, program metadata, update timestamps, and non-sensitive attachment metadata.

The YesWeHack adapter is **work in progress**. It recognizes `/programs/<program>` routes and currently supports **public programs only**. Private programs require authenticated API access and are not supported yet. For public programs, the adapter prefers structured program state already loaded by the page and uses the credential-free public API as a fallback. Exports contain the current rules, account-access and testing instructions, qualifying and non-qualifying vulnerabilities, in-scope and out-of-scope entries, asset-value reward grids, program metadata, statistics, declarations, and non-sensitive attachment metadata.

Bugcrowd is not supported yet. The adapter structure is intended to make it straightforward to add later.

## Adding a Platform Adapter

Create `platforms/<platform>.js` and export an adapter with this interface:

```js
{
  id: "platform-id",
  label: "Platform Name",

  matches(url) {
    // Return true for supported program pages.
  },

  async extract(context) {
    // Return normalized scope data.
  }
}
```

The adapter owns all platform-specific URLs, page-state handling, selectors, API or GraphQL requests, payloads, and response parsing. It must return the normalized structure used by the existing adapters, including a `capture` object holding the `source` it used (`method`, `description`, optional `endpoint`, and `complete: false` for a partial export) and the `platformUpdatedAt` timestamps the platform publishes. The popup completes that object with the retrieval time, the retrieval URL, and the content fingerprint; adapters never compute it themselves. Optional platform fields can be added to scope and reward entries when they remain platform-neutral and the generic exporters can represent them.

Import the adapter and add it to the `adapters` array in `platforms/registry.js`. The generic popup and exporters should not need to change.

## Privacy

The extension does not disclose data to its author or to third-party services. It has no telemetry or analytics.

When structured page data is unavailable, the HackerOne adapter contacts only HackerOne's first-party `/graphql` endpoint for the current program. The browser may attach the user's existing HackerOne session to that request. If HackerOne requires its page-provided CSRF request value, the adapter reads it inside the page, attaches it only to that same-origin request, and immediately lets it fall out of scope. Authentication material is never returned to the popup, persisted, logged, copied, saved, or included in diagnostics or exports. The extension never reads cookies or authorization headers.

The Intigriti adapter contacts only Intigriti's first-party program endpoints. Public routes use `/api/core/public/programs/<company>/<program>` and explicitly omit browser credentials. Authenticated researcher routes use `/api/core/researcher/programs/<company>/<program>` with `credentials: "include"` so the browser can apply the user's existing Intigriti session. The adapter never reads, returns, persists, logs, copies, or saves cookies, CSRF values, authorization headers, or other authentication material.

The work-in-progress YesWeHack adapter supports public programs only. It first reads only the matching public program object already held by the loaded page. It never reads browser storage, a Bearer token, or the Authorization header. If no matching page state is available, it contacts only YesWeHack's first-party `https://api.yeswehack.com/programs/<program>` public endpoint. That fallback uses the API's public CORS access and explicitly omits browser credentials.

Snapshot provenance is derived from data the extension already holds. The retrieval URL recorded in an export is the program page URL of the active tab, reduced to origin and path: user name, password, query string, and fragment are removed before it is stored, because none of them identify a program and all of them can carry session material on a page the extension does not control. Platform update timestamps that do not parse as dates are dropped rather than exported under a label that implies they are dates. Retrieval endpoints recorded in an export are the fixed first-party program endpoints listed above. The content fingerprint is computed locally in the popup with the browser's Web Crypto API and is never sent anywhere.

Extracted scope remains in the popup's memory until it closes. Data leaves the popup only when the user explicitly copies it or saves it to a local file.

The requested Chrome permissions and host access are limited to:

* `scripting` to run the selected adapter on a supported program page.
* `clipboardWrite` for the **Copy** action.
* `downloads` for the **Save** action.
* Exact `https://hackerone.com/*`, `https://www.hackerone.com/*`, `https://app.intigriti.com/*`, and `https://yeswehack.com/*` host access for extraction and passive supported-page detection.

A minimal service worker observes tab URL changes, applies or clears the per-tab toolbar badge, and performs no page-content access or network requests.

## Security Considerations

If you find a vulnerability in this repository, please use GitHub's [private vulnerability reporting](https://github.com/lauritzh/bug-bounty-scope-exporter/security) instead of opening a public issue.

Platform adapters must request only the fields and first-party origins needed for scope export. Authentication material must never be added to the normalized result, errors, logs, or saved files.

## Contributing

Bug fixes and focused platform adapters are welcome. Please keep the extension dependency-free and preserve the generic normalized schema, minimal permissions, and strict separation between platform adapters and shared UI/export code.

## Tests

The test suite is dependency-free. Run it with:

```sh
for test in tests/*.test.mjs; do node "$test"; done
```

## Disclaimer

Use this extension only with bug bounty programs and systems you are authorized to access. The exported scope is a convenience copy; always verify the live program page before testing because program scope can change. The snapshot provenance and fingerprint in an export make such a change detectable after the fact; they do not make a stale snapshot safe to rely on.
