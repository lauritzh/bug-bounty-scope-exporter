function extractHackerOnePage(handle) {
  const platform = "hackerone";
  const programUrl = `https://hackerone.com/${encodeURIComponent(handle)}`;

  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\r\n?/g, "\n").trim();
  };

  const severityLabel = (value) => {
    const raw = cleanText(value);
    if (!raw) return "";
    return raw
      .split("_")
      .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : "")
      .join(" ");
  };

  const booleanOrNull = (value) => typeof value === "boolean" ? value : null;
  const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

  const normalizeRecord = (record) => {
    if (!record || typeof record !== "object") return null;
    const asset = cleanText(record.identifier ?? record.asset_identifier ?? record.assetIdentifier);
    const eligible = record.eligible_for_submission ?? record.eligibleForSubmission;
    if (!asset || typeof eligible !== "boolean") return null;

    return {
      asset,
      type: cleanText(record.asset_type ?? record.assetType),
      eligibleForSubmission: eligible,
      eligibleForBounty:
        typeof (record.eligible_for_bounty ?? record.eligibleForBounty) === "boolean"
          ? (record.eligible_for_bounty ?? record.eligibleForBounty)
          : null,
      maxSeverity: severityLabel(record.cvss_score ?? record.max_severity ?? record.maxSeverity),
      instruction: cleanText(record.instruction),
    };
  };

  const unwrapList = (container) => {
    if (Array.isArray(container)) return container;
    if (!container || typeof container !== "object") return [];
    if (Array.isArray(container.nodes)) return container.nodes;
    if (Array.isArray(container.edges)) {
      return container.edges.map((edge) => edge?.node).filter(Boolean);
    }
    return [];
  };

  const buildResult = (team, records, { source = null, notes = [] } = {}) => {
    const inScope = [];
    const outOfScope = [];
    const seen = new Set();

    for (const rawRecord of records) {
      const record = normalizeRecord(rawRecord);
      if (!record) continue;
      const key = `${record.eligibleForSubmission}\u0000${record.type}\u0000${record.asset}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (record.eligibleForSubmission) {
        inScope.push({
          asset: record.asset,
          type: record.type,
          eligibleForBounty: record.eligibleForBounty,
          maxSeverity: record.maxSeverity,
          instruction: record.instruction,
        });
      } else {
        outOfScope.push({
          asset: record.asset,
          type: record.type,
          instruction: record.instruction,
        });
      }
    }

    const externalProgram = team?.external_program || {};
    const declarativePolicy = team?.declarative_policy || {};
    const bountyTable = team?.bounty_table || {};
    const nativePolicy = cleanText(team?.policy_setting?.policy);
    const externalPolicy = cleanText(externalProgram.policy);

    const rewardRows = unwrapList(bountyTable.bounty_table_rows).map((row) => ({
      name: cleanText(row?.name),
      asset: cleanText(row?.structured_scope?.asset_identifier),
      useRange: booleanOrNull(row?.use_range),
      amounts: {
        low: numberOrNull(row?.low),
        lowMinimum: numberOrNull(row?.low_minimum),
        medium: numberOrNull(row?.medium),
        mediumMinimum: numberOrNull(row?.medium_minimum),
        high: numberOrNull(row?.high),
        highMinimum: numberOrNull(row?.high_minimum),
        critical: numberOrNull(row?.critical),
        criticalMinimum: numberOrNull(row?.critical_minimum),
      },
      smartRewardsStartAt: cleanText(row?.smart_rewards_start_at),
      updatedAt: cleanText(row?.updated_at),
    }));

    const attachments = Array.isArray(team?.attachments)
      ? team.attachments.map((attachment) => ({
          fileName: cleanText(attachment?.file_name),
          fileSize: numberOrNull(attachment?.file_size),
          contentType: cleanText(attachment?.content_type),
        }))
      : [];

    return {
      platform,
      program: {
        name: cleanText(team?.name),
        handle,
        url: programUrl,
        website: cleanText(team?.website),
        about: cleanText(team?.about),
      },
      capture: {
        source,
        platformUpdatedAt: {
          policy: cleanText(team?.policy_setting?.last_policy_change_at),
          scope: cleanText(team?.structured_scope_versions?.max_visible_updated_at),
          rewards: cleanText(bountyTable.updated_at),
          declarations: cleanText(declarativePolicy.updated_at),
        },
      },
      metadata: {
        type: cleanText(team?.type),
        state: cleanText(team?.state),
        submissionState: cleanText(team?.submission_state),
        launchedAt: cleanText(team?.launched_at),
        twitterHandle: cleanText(team?.twitter_handle),
        externalUrl: cleanText(team?.external_url),
        offersBounties: booleanOrNull(team?.offers_bounties),
        offersThanks: booleanOrNull(team?.offers_thanks),
        currency: cleanText(team?.currency),
        abuseProgram: booleanOrNull(team?.abuse),
        triageActive: booleanOrNull(team?.triage_active),
        assetCredentialsAvailable: booleanOrNull(team?.asset_credentials_set_up),
        submissionRequirementsEnabled: booleanOrNull(team?.submission_requirements_enabled),
        termsRequiredAt: cleanText(team?.submission_requirements?.terms_required_at),
        onlyClearedHackers: booleanOrNull(team?.only_cleared_hackers),
        onlyIdVerifiedHackers: booleanOrNull(team?.only_id_verified_hackers),
        allowsPrivateDisclosure: booleanOrNull(team?.allows_private_disclosure),
        allowsDisclosureAssistance: booleanOrNull(team?.allows_disclosure_assistance),
        allowsBountySplitting: booleanOrNull(team?.allows_bounty_splitting),
        publiclyVisibleRetesting: booleanOrNull(team?.publicly_visible_retesting),
        scopeAndRewardsGroupsEnabled: booleanOrNull(team?.scope_and_rewards_groups_enabled),
        resolvedReportCount: numberOrNull(team?.resolved_report_count),
        lastPolicyChangeAt: cleanText(team?.policy_setting?.last_policy_change_at),
        lastScopeChangeAt: cleanText(team?.structured_scope_versions?.max_visible_updated_at),
        externalProgram: {
          offersRewards: booleanOrNull(externalProgram.offers_rewards),
          thanksUrl: cleanText(externalProgram.thanks_url),
          disclosureEmail: cleanText(externalProgram.disclosure_email),
          disclosureUrl: cleanText(externalProgram.disclosure_url),
        },
      },
      guidelines: {
        policy: nativePolicy || externalPolicy,
        policySourceUrl: cleanText(externalProgram.policy_url),
        scopeDescription: cleanText(team?.scope_description),
        introduction: cleanText(declarativePolicy.introduction),
        disclosure: cleanText(declarativePolicy.disclosure_declaration),
        contactEmail: cleanText(declarativePolicy.contact_email),
        hasOpenScope: booleanOrNull(declarativePolicy.has_open_scope),
        paysWithinOneMonth: booleanOrNull(declarativePolicy.pays_within_one_month),
        safeHarbor: {
          goldStandard: booleanOrNull(declarativePolicy.protected_by_gold_standard_safe_harbor),
          ai: booleanOrNull(declarativePolicy.protected_by_ai_safe_harbor),
        },
        skipDeclarationAutoEnrollment: booleanOrNull(team?.skip_declaration_auto_enrollment),
        updatedAt: cleanText(declarativePolicy.updated_at),
        platformStandardsExclusions: Array.isArray(declarativePolicy.platform_standards_exclusions)
          ? declarativePolicy.platform_standards_exclusions.map((exclusion) => ({
              standard: cleanText(exclusion?.platform_standard),
              justification: cleanText(exclusion?.justification),
            }))
          : [],
        exemplaryStandardsExclusions: Array.isArray(declarativePolicy.exemplary_standards_exclusions)
          ? declarativePolicy.exemplary_standards_exclusions.map(cleanText).filter(Boolean)
          : [],
        scopeExclusions: Array.isArray(declarativePolicy.scope_exclusions)
          ? declarativePolicy.scope_exclusions.map((exclusion) => ({
              category: cleanText(exclusion?.category),
              details: cleanText(exclusion?.details),
              createdAt: cleanText(exclusion?.created_at),
            }))
          : [],
      },
      rewards: {
        currency: cleanText(team?.currency),
        description: cleanText(bountyTable.description),
        useRange: booleanOrNull(bountyTable.use_range),
        labels: {
          low: cleanText(bountyTable.low_label),
          medium: cleanText(bountyTable.medium_label),
          high: cleanText(bountyTable.high_label),
          critical: cleanText(bountyTable.critical_label),
        },
        updatedAt: cleanText(bountyTable.updated_at),
        rows: rewardRows,
      },
      attachments,
      inScope,
      outOfScope,
      notes: notes.map(cleanText).filter(Boolean),
    };
  };

  const findStructuredTeam = (root) => {
    if (!root || typeof root !== "object") return null;
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;

    while (stack.length > 0 && visited < 50000) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;

      const valueHandle = cleanText(value.handle);
      if (valueHandle.toLowerCase() === handle.toLowerCase()) {
        const container =
          value.structured_scopes ?? value.structuredScopes ?? value.structured_scopes_search;
        const records = unwrapList(container);
        const expected = container?.total_count ?? container?.totalCount;
        const isExplicitArray = Array.isArray(container);
        const isComplete =
          records.length > 0 &&
          (isExplicitArray ||
            (typeof expected === "number" && Number.isFinite(expected) && records.length >= expected));

        if (isComplete) {
          return {
            team: value,
            records,
          };
        }
      }

      if (depth >= 12) continue;
      let children;
      try {
        children = Array.isArray(value) ? value : Object.values(value);
      } catch {
        continue;
      }
      for (const child of children) {
        if (child && typeof child === "object") {
          stack.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return null;
  };

  const structuredSources = [];
  for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
    const source = script.textContent || "";
    if (!source || source.length > 4_000_000) continue;
    try {
      structuredSources.push(JSON.parse(source));
    } catch {
      // Ignore unrelated or malformed embedded data.
    }
  }

  for (const globalName of ["__APOLLO_STATE__", "__NEXT_DATA__", "__INITIAL_STATE__"]) {
    try {
      if (window[globalName] && typeof window[globalName] === "object") {
        structuredSources.push(window[globalName]);
      }
    } catch {
      // A page-owned getter must not prevent the safer fallbacks.
    }
  }

  for (const source of structuredSources) {
    const team = findStructuredTeam(source);
    const requiredProgramFields = [
      "attachments",
      "bounty_table",
      "declarative_policy",
      "policy_setting",
      "scope_description",
      "state",
      "type",
    ];
    const hasProgramDetails = team?.team && requiredProgramFields.every((field) =>
      Object.prototype.hasOwnProperty.call(team.team, field),
    );
    if (hasProgramDetails) {
      return Promise.resolve({
        ok: true,
        data: buildResult(team.team, team.records, {
          source: {
            method: "embedded-page-data",
            description: "Structured program data already present in the loaded page",
          },
        }),
      });
    }
  }

  const queryApi = async () => {
    const programQuery = `
      query ProgramExporter($handle: String!, $size: Int, $from: Int) {
        team(handle: $handle) {
          name
          handle
          type
          state
          website
          about
          launched_at
          twitter_handle
          external_url
          offers_bounties
          offers_thanks
          currency
          abuse
          triage_active
          asset_credentials_set_up
          submission_state
          submission_requirements_enabled
          only_cleared_hackers
          only_id_verified_hackers
          allows_private_disclosure
          allows_disclosure_assistance
          allows_bounty_splitting
          publicly_visible_retesting
          scope_description
          scope_and_rewards_groups_enabled
          resolved_report_count
          skip_declaration_auto_enrollment
          submission_requirements {
            terms_required_at
          }
          policy_setting {
            policy
            last_policy_change_at
          }
          structured_scope_versions {
            max_visible_updated_at
          }
          external_program {
            offers_rewards
            thanks_url
            policy_url
            policy
            disclosure_email
            disclosure_url
          }
          attachments {
            file_name
            file_size
            content_type
          }
          declarative_policy {
            has_open_scope
            pays_within_one_month
            protected_by_gold_standard_safe_harbor
            protected_by_ai_safe_harbor
            disclosure_declaration
            introduction
            contact_email
            updated_at
            platform_standards_exclusions {
              justification
              platform_standard
            }
            exemplary_standards_exclusions
            scope_exclusions {
              category
              details
              created_at
            }
          }
          bounty_table {
            low_label
            medium_label
            high_label
            critical_label
            description
            use_range
            updated_at
            bounty_table_rows(first: 100) {
              nodes {
                low
                medium
                high
                critical
                low_minimum
                medium_minimum
                high_minimum
                critical_minimum
                use_range
                name
                smart_rewards_start_at
                updated_at
                structured_scope {
                  asset_identifier
                }
              }
            }
          }
          structured_scopes: structured_scopes_search(size: $size, from: $from) {
            total_count
            nodes {
              ... on StructuredScopeDocument {
                asset_type
                identifier
                eligible_for_submission
                eligible_for_bounty
                instruction
                cvss_score
              }
            }
          }
        }
      }
    `;
    const scopeQuery = `
      query ScopeExporter($handle: String!, $size: Int, $from: Int) {
        team(handle: $handle) {
          structured_scopes: structured_scopes_search(size: $size, from: $from) {
            total_count
            nodes {
              ... on StructuredScopeDocument {
                asset_type
                identifier
                eligible_for_submission
                eligible_for_bounty
                instruction
                cvss_score
              }
            }
          }
        }
      }
    `;
    const pageSize = 500;
    const records = [];
    let teamDetails = null;
    let total = null;

    for (let page = 0; page < 20; page += 1) {
      let response;
      try {
        const requestHeaders = {
          accept: "application/json",
          "content-type": "application/json",
          "x-product-area": "other",
          "x-product-feature": "other",
        };
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        if (typeof csrfToken === "string" && csrfToken) {
          requestHeaders["x-csrf-token"] = csrfToken;
        }

        response = await fetch("/graphql", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: requestHeaders,
          body: JSON.stringify({
            operationName: page === 0 ? "ProgramExporter" : "ScopeExporter",
            query: page === 0 ? programQuery : scopeQuery,
            variables: { handle, size: pageSize, from: records.length },
          }),
        });
      } catch {
        throw new Error("Could not reach HackerOne's scope API.");
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error("HackerOne denied the scope request. Sign in or confirm that you can view this program.");
      }
      if (!response.ok) {
        throw new Error(`HackerOne's scope request failed (HTTP ${response.status}).`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("HackerOne returned an unreadable scope response.");
      }

      const team = payload?.data?.team;
      if (!team && page === 0) {
        if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
          throw new Error("HackerOne could not provide this scope. Check your access or try again after the site is updated.");
        }
        throw new Error("This page is not an available HackerOne program.");
      }

      if (page === 0) teamDetails = team;
      const scopes = team.structured_scopes;
      const nodes = scopes?.nodes;
      const reportedTotal = scopes?.total_count;
      if (!Array.isArray(nodes) || typeof reportedTotal !== "number" || !Number.isFinite(reportedTotal)) {
        throw new Error("HackerOne's scope API response was not recognized. The site may have changed.");
      }
      total = reportedTotal;
      records.push(...nodes);

      if (!Number.isFinite(total) || records.length >= total) break;
      if (nodes.length === 0) break;
    }

    if (Number.isFinite(total) && records.length < total) {
      throw new Error("The program scope is too large to export safely in one operation.");
    }

    return buildResult(teamDetails, records, {
      source: {
        method: "first-party-api",
        description: "HackerOne GraphQL API",
        endpoint: `${location.origin}/graphql`,
      },
    });
  };

  const queryDom = () => {
    const records = [];

    for (const table of document.querySelectorAll("table")) {
      const headers = Array.from(table.querySelectorAll("thead th"), (cell) => cleanText(cell.textContent).toLowerCase());
      if (headers.length === 0) continue;

      const findColumn = (...terms) => headers.findIndex((header) => terms.some((term) => header.includes(term)));
      const assetColumn = findColumn("identifier", "asset");
      const typeColumn = findColumn("type");
      const scopeColumn = findColumn("scope", "submission");
      const bountyColumn = findColumn("bounty");
      const severityColumn = findColumn("severity");
      const notesColumn = findColumn("notes", "instruction");
      if (assetColumn < 0 || scopeColumn < 0) continue;

      for (const row of table.querySelectorAll("tbody tr")) {
        const cells = Array.from(row.children).filter((cell) => cell.matches("th, td"));
        const cellText = (index) => index >= 0 && cells[index] ? cleanText(cells[index].innerText) : "";
        const asset = cellText(assetColumn).split("\n")[0].trim();
        const scopeText = cellText(scopeColumn).toLowerCase();
        if (!asset) continue;

        let eligibleForSubmission = null;
        if (/out of scope|not eligible/.test(scopeText)) eligibleForSubmission = false;
        else if (/in scope|eligible/.test(scopeText)) eligibleForSubmission = true;
        if (eligibleForSubmission === null) continue;

        const bountyText = cellText(bountyColumn).toLowerCase();
        let eligibleForBounty = null;
        if (bountyText) {
          eligibleForBounty = !/not eligible|no|false/.test(bountyText);
        }

        records.push({
          identifier: asset,
          asset_type: cellText(typeColumn),
          eligible_for_submission: eligibleForSubmission,
          eligible_for_bounty: eligibleForBounty,
          cvss_score: cellText(severityColumn),
          instruction: cellText(notesColumn),
        });
      }
    }

    if (records.length === 0) return null;
    const heading = document.querySelector("main h1, h1");
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
    const name = cleanText(heading?.textContent) || cleanText(ogTitle).replace(/\s+-\s+Bug Bounty Program.*$/i, "");
    return buildResult({ name }, records, {
      source: {
        method: "rendered-page",
        description: "Scope table rendered on the program page",
        endpoint: location.href,
        complete: false,
      },
      notes: ["Partial export: HackerOne's structured program metadata and policy could not be retrieved; only the visible scope table was available."],
    });
  };

  return queryApi()
    .then((data) => ({ ok: true, data }))
    .catch((error) => {
      const domData = queryDom();
      if (domData) return { ok: true, data: domData };
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not extract this HackerOne program's scope.",
      };
    });
}

function getHandle(url) {
  try {
    const parsed = new URL(url);
    const [segment] = parsed.pathname.split("/").filter(Boolean);
    if (!segment) return "";
    const handle = decodeURIComponent(segment);
    return /^[a-z0-9_-]+$/i.test(handle) ? handle : "";
  } catch {
    return "";
  }
}

const nonProgramRoutes = new Set([
  "api",
  "bugs",
  "dashboard",
  "directory",
  "graphql",
  "hacktivity",
  "invitations",
  "leaderboard",
  "login",
  "logout",
  "notifications",
  "opportunities",
  "organizations",
  "reports",
  "resources",
  "search",
  "sessions",
  "settings",
  "support",
  "users",
]);

function isProgramPage(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["hackerone.com", "www.hackerone.com"].includes(parsed.hostname)) {
      return false;
    }

    const handle = getHandle(url);
    if (!handle || nonProgramRoutes.has(handle.toLowerCase())) return false;

    const resourceType = parsed.searchParams.get("type");
    if (resourceType && resourceType !== "team") return false;

    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length === 1 ||
      (segments.length === 2 &&
        ["policy", "policy_scopes", "policy_versions", "scope_versions", "scopes"].includes(segments[1]));
  } catch {
    return false;
  }
}

const hackerone = {
  id: "hackerone",
  label: "HackerOne",

  matches(url) {
    return isProgramPage(url);
  },

  async extract(context) {
    const handle = getHandle(context.url);
    if (!handle) {
      throw new Error("Open a HackerOne program page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractHackerOnePage,
      args: [handle],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this HackerOne program's scope.");
    }
    return result.data;
  },
};

export default hackerone;
