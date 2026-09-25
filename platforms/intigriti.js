function extractIntigritiPage(companyHandle, programHandle, researcherRoute) {
  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\r\n?/g, "\n").trim();
  };

  const booleanOrNull = (value) => typeof value === "boolean" ? value : null;
  const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const timestamp = (value) => {
    const seconds = numberOrNull(value);
    if (seconds === null) return "";
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };

  const latest = (versions) => {
    if (!Array.isArray(versions)) return null;
    return versions.reduce((current, candidate) => {
      if (!candidate || typeof candidate !== "object") return current;
      return !current || Number(candidate.createdAt) > Number(current.createdAt) ? candidate : current;
    }, null);
  };

  const assetTypes = new Map([
    [1, "URL"],
    [2, "ANDROID"],
    [3, "IOS"],
    [4, "IP RANGE"],
    [5, "DEVICE"],
    [6, "OTHER"],
    [7, "WILDCARD"],
    [8, "SOURCE CODE"],
    [9, "AI MODEL"],
  ]);
  const bountyTiers = new Map([
    [1, "No bounty"],
    [2, "Tier 3"],
    [3, "Tier 2"],
    [4, "Tier 1"],
    [5, "Out of scope"],
    [6, "Tier 4"],
    [7, "Tier 5"],
  ]);
  const statuses = new Map([
    [1, "Wizard"],
    [2, "Draft"],
    [3, "Open"],
    [4, "Suspended"],
    [5, "Closing"],
    [6, "Closed"],
    [7, "Archived"],
    [8, "Deleted"],
    [1001, "Hybrid draft"],
    [1002, "Hybrid enrolling"],
    [1003, "Hybrid open"],
    [1004, "Hybrid closing"],
    [1005, "Hybrid closed"],
    [1006, "Hybrid deleted"],
    [1007, "Hybrid wizard"],
  ]);
  const confidentialityLevels = new Map([
    [1, "Invite only"],
    [2, "Application"],
    [3, "Registered"],
    [4, "Public"],
  ]);

  const safeSource = (value) => {
    let source = value;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      source = source.url ?? source.value ?? source.name ?? source.repository;
    }
    const result = cleanText(source);
    if (!result) return "";

    try {
      const parsed = new URL(result);
      parsed.username = "";
      parsed.password = "";
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (/(auth|credential|key|secret|signature|token)/i.test(key)) {
          parsed.searchParams.delete(key);
        }
      }
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return result;
    }
  };

  const normalizeAttachment = (attachment, section) => {
    if (!attachment || typeof attachment !== "object") return null;
    const normalized = {
      section,
      fileName: cleanText(attachment.fileName ?? attachment.name),
      fileSize: numberOrNull(attachment.fileSize ?? attachment.size),
      contentType: cleanText(attachment.contentType ?? attachment.mimeType),
    };
    return normalized.fileName || normalized.fileSize !== null || normalized.contentType ? normalized : null;
  };

  const section = (versions, name) => {
    const version = latest(versions);
    const attachments = Array.isArray(version?.content?.attachments)
      ? version.content.attachments.map((attachment) => normalizeAttachment(attachment, name)).filter(Boolean)
      : [];
    return {
      value: version?.content?.content,
      updatedAt: timestamp(version?.createdAt),
      attachments,
    };
  };

  const moneyValue = (money) => numberOrNull(money?.value);
  const moneyCurrency = (money, fallback) => cleanText(money?.currency) || fallback;
  const payoutValue = (value) => {
    const direct = numberOrNull(value);
    if (direct !== null) return direct;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const amount = numberOrNull(value.value ?? value.amount);
    if (amount === null) return null;
    return {
      value: amount,
      currency: cleanText(value.currency),
    };
  };

  const buildResult = (data, source = null) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Intigriti returned an unexpected program response.");
    }

    const assetsVersion = latest(data.assetsCollection);
    const bountyVersion = latest(data.bountyTables);
    const inScopeSection = section(data.inScopes, "In-scope guidance");
    const outOfScopeSection = section(data.outOfScopes, "Out-of-scope guidance");
    const faqSection = section(data.faqs, "FAQ");
    const severitySection = section(data.severityAssessments, "Severity assessment");
    const rulesSection = section(data.rulesOfEngagements, "Rules of engagement");
    const rules = rulesSection.value && typeof rulesSection.value === "object" ? rulesSection.value : {};
    const testingRequirements = rules.testingRequirements && typeof rules.testingRequirements === "object"
      ? rules.testingRequirements
      : {};

    const metadataByAssetId = new Map(
      (Array.isArray(data.assetsMetadata) ? data.assetsMetadata : [])
        .filter((item) => item && typeof item === "object")
        .map((item) => [cleanText(item.assetId), item]),
    );
    const inScope = [];
    const outOfScope = [];
    const seen = new Set();

    const addAsset = (asset, group = null) => {
      if (!asset || typeof asset !== "object") return;
      const assetName = cleanText(asset.name);
      if (!assetName) return;

      const assetId = cleanText(asset.companyAssetId ?? asset.assetId ?? asset.id);
      const assetMetadata = metadataByAssetId.get(assetId) || {};
      const typeId = numberOrNull(asset.typeId ?? group?.typeId);
      const tierId = numberOrNull(asset.bountyTierId ?? group?.bountyTierId);
      const isOutOfScope = tierId === 5;
      const requiredSkills = Array.isArray(assetMetadata.requiredSkills)
        ? assetMetadata.requiredSkills.map(cleanText).filter(Boolean)
        : [];
      const instruction = [cleanText(group?.description), cleanText(asset.description)]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join("\n\n");
      const entry = {
        asset: assetName,
        type: assetTypes.get(typeId) || "",
        assetTypeId: typeId,
        group: cleanText(group?.name),
        bountyTier: bountyTiers.get(tierId) || "",
        bountyTierId: tierId,
        requiredSkills,
        source: safeSource(assetMetadata.source),
        instruction,
      };

      const key = `${isOutOfScope}\u0000${entry.type}\u0000${entry.asset}\u0000${entry.group}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (isOutOfScope) {
        outOfScope.push(entry);
      } else {
        entry.eligibleForBounty = tierId === 1
          ? false
          : ([2, 3, 4, 6, 7].includes(tierId) ? true : null);
        entry.maxSeverity = "";
        inScope.push(entry);
      }
    };

    const assetsAndGroups = Array.isArray(assetsVersion?.content?.assetsAndGroups)
      ? assetsVersion.content.assetsAndGroups
      : [];
    for (const item of assetsAndGroups) {
      if (item?.discriminator === 2) {
        for (const asset of Array.isArray(item.assets) ? item.assets : []) addAsset(asset, item);
      } else {
        addAsset(item);
      }
    }

    const currency = cleanText(bountyVersion?.content?.currency);
    const bountyRows = Array.isArray(bountyVersion?.content?.bountyRows)
      ? bountyVersion.content.bountyRows
      : [];
    const tiers = bountyRows.map((row) => {
      const tierId = numberOrNull(row?.bountyTierId);
      return {
        tier: bountyTiers.get(tierId) || "",
        bountyTierId: tierId,
        ranges: (Array.isArray(row?.bountyRanges) ? row.bountyRanges : []).map((range) => ({
          minScore: numberOrNull(range?.minScore),
          maxScore: numberOrNull(range?.maxScore),
          minBounty: moneyValue(range?.minBounty),
          maxBounty: moneyValue(range?.maxBounty),
          currency: moneyCurrency(range?.minBounty ?? range?.maxBounty, currency),
        })),
      };
    });

    const statusCode = numberOrNull(data.status);
    const confidentialityCode = numberOrNull(data.confidentialityLevel);
    const routePrefix = researcherRoute ? "/researcher/programs" : "/programs";
    const canonicalUrl = `https://app.intigriti.com${routePrefix}/${encodeURIComponent(companyHandle)}/${encodeURIComponent(programHandle)}/detail`;

    const platformUpdatedAt = {
      assets: timestamp(assetsVersion?.createdAt),
      inScope: inScopeSection.updatedAt,
      outOfScope: outOfScopeSection.updatedAt,
      faq: faqSection.updatedAt,
      severityAssessment: severitySection.updatedAt,
      rulesOfEngagement: rulesSection.updatedAt,
      rewards: timestamp(bountyVersion?.createdAt),
    };

    return {
      platform: "intigriti",
      program: {
        name: cleanText(data.name),
        handle: cleanText(data.handle) || programHandle,
        url: canonicalUrl,
        website: "",
        about: cleanText(data.description),
      },
      capture: {
        source,
        platformUpdatedAt,
      },
      metadata: {
        companyName: cleanText(data.companyName),
        companyHandle: cleanText(data.companyHandle) || companyHandle,
        programId: cleanText(data.programId),
        logoId: cleanText(data.logoId),
        status: statuses.get(statusCode) || "",
        statusCode,
        confidentiality: confidentialityLevels.get(confidentialityCode) || "",
        confidentialityLevel: confidentialityCode,
        industry: cleanText(data.industry),
        awardsReputation: booleanOrNull(data.awardRep),
        allowsCollaboration: booleanOrNull(data.allowCollaboration),
        skipsTriage: booleanOrNull(data.skipTriage),
        hasUpdates: booleanOrNull(data.hasUpdates),
        submissionCount: numberOrNull(data.submissionCount),
        acceptedSubmissionCount: numberOrNull(data.acceptedSubmissionCount),
        averagePayout: payoutValue(data.averagePayout),
        totalPayout: payoutValue(data.totalPayout),
        updatedAt: { ...platformUpdatedAt },
      },
      guidelines: {
        policy: cleanText(rules.description),
        policySourceUrl: "",
        scopeDescription: cleanText(inScopeSection.value),
        outOfScopeDescription: cleanText(outOfScopeSection.value),
        faq: cleanText(faqSection.value),
        severityAssessment: cleanText(severitySection.value),
        testingRequirements: {
          intigritiMe: booleanOrNull(testingRequirements.intigritiMe),
          automatedToolingRequestsPerSecond: numberOrNull(testingRequirements.automatedTooling),
          userAgent: cleanText(testingRequirements.userAgent),
          requestHeader: cleanText(testingRequirements.requestHeader),
        },
        safeHarbor: {
          intigriti: booleanOrNull(rules.safeHarbour),
        },
        updatedAt: rulesSection.updatedAt || timestamp(rules.createdAt),
        platformStandardsExclusions: [],
        exemplaryStandardsExclusions: [],
        scopeExclusions: [],
      },
      rewards: {
        currency,
        description: cleanText(bountyVersion?.content?.rewardPolicy),
        updatedAt: timestamp(bountyVersion?.createdAt),
        rows: [],
        tiers,
      },
      attachments: [
        ...inScopeSection.attachments,
        ...outOfScopeSection.attachments,
        ...faqSection.attachments,
        ...severitySection.attachments,
        ...rulesSection.attachments,
      ],
      inScope,
      outOfScope,
      notes: [],
    };
  };

  if (location.protocol !== "https:" || location.hostname !== "app.intigriti.com") {
    return Promise.resolve({ ok: false, error: "Open an Intigriti program page and try again." });
  }

  const apiAudience = researcherRoute ? "researcher" : "public";
  const endpoint = `/api/core/${apiAudience}/programs/${encodeURIComponent(companyHandle)}/${encodeURIComponent(programHandle)}`;
  return fetch(endpoint, {
    method: "GET",
    credentials: researcherRoute ? "include" : "omit",
    cache: "no-store",
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (response.status === 401 || response.status === 403) {
      throw new Error(researcherRoute
        ? "Intigriti denied the program request. Sign in and confirm that your account can access this program."
        : "Intigriti denied the public program request. Confirm that this program is publicly viewable.");
    }
    if (response.status === 404) {
      throw new Error("Intigriti could not find this program.");
    }
    if (!response.ok) {
      throw new Error(`Intigriti returned HTTP ${response.status} while loading this program.`);
    }
    return buildResult(await response.json(), {
      method: "first-party-api",
      description: researcherRoute ? "Intigriti researcher program API" : "Intigriti public program API",
      endpoint: `https://app.intigriti.com${endpoint}`,
    });
  }).then((data) => ({ ok: true, data })).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not extract this Intigriti program's scope.",
  }));
}

function getProgramRoute(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "app.intigriti.com") return null;

    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const publicRoute = segments.length === 4 && segments[0] === "programs" && segments[3] === "detail";
    const researcherRoute = segments.length === 5
      && segments[0] === "researcher"
      && segments[1] === "programs"
      && segments[4] === "detail";
    if (!publicRoute && !researcherRoute) return null;

    const companyHandle = segments[researcherRoute ? 2 : 1];
    const programHandle = segments[researcherRoute ? 3 : 2];
    if (!/^[a-z0-9_-]+$/i.test(companyHandle) || !/^[a-z0-9_-]+$/i.test(programHandle)) return null;
    return { companyHandle, programHandle, researcherRoute };
  } catch {
    return null;
  }
}

const intigriti = {
  id: "intigriti",
  label: "Intigriti",

  matches(url) {
    return Boolean(getProgramRoute(url));
  },

  async extract(context) {
    const route = getProgramRoute(context.url);
    if (!route) {
      throw new Error("Open an Intigriti program page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractIntigritiPage,
      args: [route.companyHandle, route.programHandle, route.researcherRoute],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this Intigriti program's scope.");
    }
    return result.data;
  },
};

export default intigriti;
