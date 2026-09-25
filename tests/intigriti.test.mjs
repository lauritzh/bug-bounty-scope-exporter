import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let executeOptions;
let responseFactory;
let fetchCall;

globalThis.chrome = {
  scripting: {
    async executeScript(options) {
      executeOptions = options;
      globalThis.location = {
        protocol: "https:",
        hostname: "app.intigriti.com",
      };
      globalThis.fetch = async (url, init) => {
        fetchCall = { url, init };
        return responseFactory();
      };
      return [{ result: await options.func(...options.args) }];
    },
  },
};

const adapterSource = await readFile(new URL("../platforms/intigriti.js", import.meta.url), "utf8");
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`;
const { default: intigriti } = await import(adapterUrl);

const publicUrl = "https://app.intigriti.com/programs/intel/intelvulnerabilitydisclosureprogram/detail";
const researcherUrl = "https://app.intigriti.com/researcher/programs/qualified/qualifiedbugbounty/detail";
const researcherExampleUrl = "https://app.intigriti.com/researcher/programs/onetwobuild/12build/detail";

assert.equal(intigriti.matches(publicUrl), true);
assert.equal(intigriti.matches(`${publicUrl}/?view=scope`), true);
assert.equal(intigriti.matches(researcherUrl), true);
assert.equal(intigriti.matches(`${researcherUrl}?tab=scope`), true);
assert.equal(intigriti.matches(researcherExampleUrl), true);
assert.equal(intigriti.matches("https://app.intigriti.com/researcher/programs/qualified/qualifiedbugbounty"), false);
assert.equal(intigriti.matches("https://evil.example/researcher/programs/qualified/qualifiedbugbounty/detail"), false);

const fixture = {
  name: "Qualified Bug Bounty",
  handle: "qualifiedbugbounty",
  companyName: "Qualified",
  companyHandle: "qualified",
  status: 3,
  confidentialityLevel: 3,
  assetsMetadata: [{ assetId: "asset-1", requiredSkills: ["web"], source: null }],
  assetsCollection: [{
    createdAt: 1_700_000_000,
    content: {
      assetsAndGroups: [
        {
          discriminator: 1,
          companyAssetId: "asset-1",
          name: "*.qualified.example",
          typeId: 7,
          bountyTierId: 4,
          description: "Production wildcard",
        },
        {
          discriminator: 1,
          companyAssetId: "asset-2",
          name: "Future asset type",
          typeId: 999,
          bountyTierId: 998,
        },
      ],
    },
  }],
  inScopes: [{ createdAt: 1_700_000_001, content: { content: "Test only listed assets.", attachments: [] } }],
  outOfScopes: [],
  faqs: [],
  severityAssessments: [],
  rulesOfEngagements: [{
    createdAt: 1_700_000_002,
    content: {
      content: {
        description: "Follow the rules.",
        safeHarbour: true,
        testingRequirements: {},
      },
      attachments: [],
    },
  }],
  bountyTables: [],
};

responseFactory = () => ({
  status: 200,
  ok: true,
  async json() {
    return fixture;
  },
});

const normalized = await intigriti.extract({ tabId: 42, url: researcherUrl });
assert.equal(executeOptions.world, "MAIN");
assert.deepEqual(executeOptions.args, ["qualified", "qualifiedbugbounty", true]);
assert.equal(fetchCall.url, "/api/core/researcher/programs/qualified/qualifiedbugbounty");
assert.equal(fetchCall.init.credentials, "include");
assert.equal(normalized.platform, "intigriti");
assert.equal(normalized.program.url, researcherUrl);
assert.equal(normalized.inScope[0].asset, "*.qualified.example");
assert.equal(normalized.inScope[0].type, "WILDCARD");
assert.equal(normalized.inScope[0].assetTypeId, 7);
assert.equal(normalized.inScope[0].bountyTier, "Tier 1");
assert.equal(normalized.inScope[0].bountyTierId, 4);
assert.equal(normalized.inScope[0].eligibleForBounty, true);
assert.equal(normalized.inScope[1].type, "");
assert.equal(normalized.inScope[1].assetTypeId, 999);
assert.equal(normalized.inScope[1].bountyTier, "");
assert.equal(normalized.inScope[1].bountyTierId, 998);
assert.equal(normalized.inScope[1].eligibleForBounty, null);
assert.equal(normalized.guidelines.policy, "Follow the rules.");
assert.deepEqual(normalized.capture.source, {
  method: "first-party-api",
  description: "Intigriti researcher program API",
  endpoint: "https://app.intigriti.com/api/core/researcher/programs/qualified/qualifiedbugbounty",
});
assert.equal(normalized.capture.platformUpdatedAt.assets, "2023-11-14T22:13:20.000Z");
assert.equal(normalized.capture.platformUpdatedAt.rulesOfEngagement, "2023-11-14T22:13:22.000Z");
assert.deepEqual(normalized.capture.platformUpdatedAt, normalized.metadata.updatedAt);

responseFactory = () => ({
  status: 200,
  ok: true,
  async json() {
    return fixture;
  },
});
const publicNormalized = await intigriti.extract({ tabId: 42, url: publicUrl });
assert.deepEqual(executeOptions.args, ["intel", "intelvulnerabilitydisclosureprogram", false]);
assert.equal(fetchCall.url, "/api/core/public/programs/intel/intelvulnerabilitydisclosureprogram");
assert.equal(fetchCall.init.credentials, "omit");
assert.equal(publicNormalized.program.url, publicUrl);
assert.equal(publicNormalized.capture.source.description, "Intigriti public program API");
assert.equal(
  publicNormalized.capture.source.endpoint,
  "https://app.intigriti.com/api/core/public/programs/intel/intelvulnerabilitydisclosureprogram",
);

responseFactory = () => ({ status: 403, ok: false });
await assert.rejects(
  intigriti.extract({ tabId: 42, url: researcherUrl }),
  /Sign in and confirm that your account can access this program/,
);

console.log("Intigriti route and normalization tests passed.");
