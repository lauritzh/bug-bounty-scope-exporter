import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let executeOptions;
let fetchCall;
let responseFactory;
let pageProgram;

globalThis.chrome = {
  scripting: {
    async executeScript(options) {
      executeOptions = options;
      globalThis.location = { protocol: "https:", hostname: "yeswehack.com" };
      if (pageProgram) {
        globalThis.document = {
          querySelectorAll(selector) {
            if (selector.startsWith("script")) return [];
            return [{ __ngContext__: [{ accessToken: "must-not-export" }, { program: pageProgram }] }];
          },
        };
      } else {
        delete globalThis.document;
      }
      globalThis.fetch = async (url, init) => {
        fetchCall = { url, init };
        return responseFactory();
      };
      return [{ result: await options.func(...options.args) }];
    },
  },
};

const adapterSource = await readFile(new URL("../platforms/yeswehack.js", import.meta.url), "utf8");
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`;
const { default: yeswehack } = await import(adapterUrl);
assert.equal(yeswehack.label, "YesWeHack (WIP)");

const programUrl = "https://yeswehack.com/programs/example-program";
assert.equal(yeswehack.matches(programUrl), true);
assert.equal(yeswehack.matches(`${programUrl}/`), true);
assert.equal(yeswehack.matches(`${programUrl}?tab=scope`), true);
assert.equal(yeswehack.matches(`${programUrl}/updates`), false);
assert.equal(yeswehack.matches("https://api.yeswehack.com/programs/example-program"), false);

const fixture = {
  title: "Example Program",
  slug: "example-program",
  rules: "## Rules\n\nTest only the listed assets.",
  type: "bug-bounty",
  status: "V",
  public: true,
  bounty: true,
  gift: false,
  business_unit: { name: "Example", slug: "example", description: "Example company", currency: "EUR" },
  scopes: [{
    scope: "https://example.com",
    scope_type: "web-application",
    scope_type_name: "Web application",
    asset_value: "LOW",
    report_count: 4,
  }],
  out_of_scope: ["All unlisted assets."],
  qualifying_vulnerability: ["SQL injection"],
  non_qualifying_vulnerability: ["Missing security headers"],
  account_access: "Self-register with your YesWeHack alias.",
  user_agent: "YWH researcher",
  reward_grid_default: { bounty_low: 50, bounty_medium: 300, bounty_high: 800, bounty_critical: 2_000 },
  reward_grid_low: { bounty_low: 50, bounty_medium: 300, bounty_high: 1_200, bounty_critical: 3_000 },
  bounty_reward_min: 50,
  bounty_reward_max: 3_000,
  attachments: [{
    original_name: "instructions.pdf",
    mime_type: "application/pdf",
    size: 123,
    url: "https://files.example/instructions.pdf?token=must-not-export",
  }],
  last_update_at: "2026-09-22T15:38:15+02:00",
};

responseFactory = () => ({ status: 200, ok: true, async json() { return fixture; } });
const normalized = await yeswehack.extract({ tabId: 42, url: programUrl });

assert.equal(executeOptions.world, "MAIN");
assert.deepEqual(executeOptions.args, ["example-program"]);
assert.equal(fetchCall.url, "https://api.yeswehack.com/programs/example-program");
assert.equal(fetchCall.init.credentials, "omit");
assert.equal(normalized.platform, "yeswehack");
assert.equal(normalized.program.url, programUrl);
assert.equal(normalized.inScope[0].asset, "https://example.com");
assert.equal(normalized.inScope[0].rewardGrid, "LOW");
assert.equal(normalized.outOfScope[0].asset, "All unlisted assets.");
assert.equal(normalized.guidelines.policy, fixture.rules);
assert.deepEqual(normalized.guidelines.qualifyingVulnerabilities, ["SQL injection"]);
assert.equal(normalized.rewards.rows.length, 2);
assert.deepEqual(normalized.attachments[0], {
  section: "Program rules",
  fileName: "instructions.pdf",
  fileSize: 123,
  contentType: "application/pdf",
});
assert.equal(JSON.stringify(normalized).includes("must-not-export"), false);

pageProgram = { ...fixture, slug: "private-program", public: false };
fetchCall = null;
await assert.rejects(
  yeswehack.extract({
    tabId: 42,
    url: "https://yeswehack.com/programs/private-program",
  }),
  /work in progress and currently limited to public programs/,
);
assert.equal(fetchCall, null);
pageProgram = null;

const exporterSource = await readFile(new URL("../lib/exporters.js", import.meta.url), "utf8");
const exporterUrl = `data:text/javascript;base64,${Buffer.from(exporterSource).toString("base64")}`;
const { toJSON, toMarkdown } = await import(exporterUrl);
assert.equal(JSON.stringify(JSON.parse(toJSON(normalized))), JSON.stringify(normalized));
const markdown = toMarkdown(normalized, { platformLabel: "YesWeHack" });
assert.match(markdown, /### Account Access/);
assert.match(markdown, /### Qualifying Vulnerabilities/);
assert.match(markdown, /\| `https:\/\/example\.com` \| Web application \| LOW \| Yes \|/);
assert.match(markdown, /\| Low asset value \|  \| 50 EUR \| 300 EUR \| 1200 EUR \| 3000 EUR \|/);

responseFactory = () => ({ status: 403, ok: false });
await assert.rejects(
  yeswehack.extract({ tabId: 42, url: programUrl }),
  /Confirm that this program is publicly viewable/,
);

console.log("YesWeHack public route, normalization, export, privacy, and WIP tests passed.");
