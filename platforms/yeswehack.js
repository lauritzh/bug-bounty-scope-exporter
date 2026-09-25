function extractYesWeHackPage(programSlug) {
  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\r\n?/g, "\n").trim();
  };
  const booleanOrNull = (value) => typeof value === "boolean" ? value : null;
  const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const scalarOrNull = (value) => ["boolean", "number", "string"].includes(typeof value) ? value : null;
  const stringList = (value) => Array.isArray(value)
    ? value.map((item) => cleanText(item?.name ?? item?.label ?? item)).filter(Boolean)
    : [];

  const fileMetadata = (file, section = "") => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return null;
    const normalized = {
      section,
      fileName: cleanText(file.original_name ?? file.file_name ?? file.name),
      fileSize: numberOrNull(file.size ?? file.file_size),
      contentType: cleanText(file.mime_type ?? file.content_type),
    };
    return normalized.fileName || normalized.fileSize !== null || normalized.contentType ? normalized : null;
  };

  const scalarObject = (value, keys) => {
    const result = {};
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    for (const key of keys) {
      const child = source[key];
      if (typeof child === "boolean" || typeof child === "number" || typeof child === "string" || child === null) {
        result[key] = child;
      }
    }
    return result;
  };

  const normalizeRewardGrid = (grid, name) => {
    const source = grid && typeof grid === "object" && !Array.isArray(grid) ? grid : {};
    return {
      name,
      asset: "",
      useRange: false,
      amounts: {
        low: numberOrNull(source.bounty_low),
        lowMinimum: null,
        medium: numberOrNull(source.bounty_medium),
        mediumMinimum: null,
        high: numberOrNull(source.bounty_high),
        highMinimum: null,
        critical: numberOrNull(source.bounty_critical),
        criticalMinimum: null,
      },
    };
  };

  const buildResult = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("YesWeHack returned an unexpected program response.");
    }
    if (data.public === false) {
      throw new Error("YesWeHack support is work in progress and currently limited to public programs.");
    }

    const currency = cleanText(data.business_unit?.currency);
    const scopes = Array.isArray(data.scopes) ? data.scopes : [];
    const inScope = scopes.map((scope) => ({
      asset: cleanText(scope?.scope),
      type: cleanText(scope?.scope_type_name ?? scope?.scope_type),
      rewardGrid: cleanText(scope?.asset_value),
      reportCount: numberOrNull(scope?.report_count),
      eligibleForBounty: typeof data.bounty === "boolean" ? data.bounty : null,
      maxSeverity: "",
      instruction: "",
    })).filter((scope) => scope.asset);

    const outOfScope = stringList(data.out_of_scope).map((asset) => ({
      asset,
      type: "",
      instruction: "",
    }));

    const attachments = (Array.isArray(data.attachments) ? data.attachments : [])
      .map((attachment) => fileMetadata(attachment, "Program rules"))
      .filter(Boolean);
    const thumbnail = fileMetadata(data.thumbnail, "Program thumbnail");
    const banner = fileMetadata(data.banner, "Program banner");
    const businessUnitLogo = fileMetadata(data.business_unit?.logo, "Business unit logo");

    const rewardRows = [
      [data.reward_grid_default, "Default"],
      [data.reward_grid_very_low, "Very low asset value"],
      [data.reward_grid_low, "Low asset value"],
      [data.reward_grid_medium, "Medium asset value"],
      [data.reward_grid_high, "High asset value"],
      [data.reward_grid_critical, "Critical asset value"],
    ].filter(([grid]) => grid && typeof grid === "object" && !Array.isArray(grid))
      .map(([grid, name]) => normalizeRewardGrid(grid, name));

    const stats = scalarObject(data.stats, [
      "max_reward",
      "average_reward",
      "average_first_time_response",
      "total_reports",
      "total_reports_last24_hours",
      "total_reports_last7_days",
      "total_reports_current_month",
    ]);
    const programMetrics = scalarObject(data.program_metrics, [
      "report_count",
      "rewards_total_amount",
      "hunter_members_count",
      "active_hunters_count",
      "reports_in_progress_count",
      "reports_in_progress_high_critical_count",
      "reports_assessed_count",
      "reports_assessed_high_critical_count",
      "reports_accepted_count",
      "reports_accepted_high_critical_count",
      "reports_resolved_count",
      "reports_closed_count",
      "computed_at",
    ]);

    return {
      platform: "yeswehack",
      program: {
        name: cleanText(data.title),
        handle: cleanText(data.slug) || programSlug,
        url: `https://yeswehack.com/programs/${encodeURIComponent(programSlug)}`,
        website: "",
        about: cleanText(data.business_unit?.description),
      },
      metadata: {
        type: cleanText(data.type),
        status: cleanText(data.status),
        public: booleanOrNull(data.public),
        demo: booleanOrNull(data.demo),
        disabled: booleanOrNull(data.disabled),
        archived: booleanOrNull(data.archived),
        secured: booleanOrNull(data.secured),
        triaged: scalarOrNull(data.triaged),
        vulnerabilityDisclosureProgram: booleanOrNull(data.vdp),
        offersBounties: booleanOrNull(data.bounty),
        offersGifts: booleanOrNull(data.gift),
        hallOfFame: booleanOrNull(data.hall_of_fame),
        publicHacktivity: booleanOrNull(data.hacktivity),
        reportCountPerScope: booleanOrNull(data.report_count_per_scope),
        reportCollaborationActive: booleanOrNull(data.report_collaboration_active),
        reportsCount: numberOrNull(data.reports_count),
        reportsImportedCount: numberOrNull(data.reports_imported_count),
        scopesCount: numberOrNull(data.scopes_count),
        tags: stringList(data.tags),
        supportedLanguages: stringList(data.supported_languages),
        event: scalarOrNull(data.event),
        reportSubmissionCost: numberOrNull(data.report_submission_cost),
        reportImportLimit: numberOrNull(data.report_import_nb_max),
        reportImportLineLimit: numberOrNull(data.report_import_line_max),
        maximumCredentialPoolSize: numberOrNull(data.max_credential_pool_number),
        hunterMessagesEnabled: booleanOrNull(data.hunter_message_enabled),
        hunterMessageValidationRequired: booleanOrNull(data.send_hunter_message_validation_required),
        videosInAttachmentsEnabled: booleanOrNull(data.videos_attachments_enabled),
        hasPendingVersion: booleanOrNull(data.has_pending_version),
        hasHistory: booleanOrNull(data.has_history),
        lastUpdatedAt: cleanText(data.last_update_at),
        businessUnit: {
          name: cleanText(data.business_unit?.name),
          slug: cleanText(data.business_unit?.slug),
          description: cleanText(data.business_unit?.description),
          currency,
        },
        media: {
          thumbnail,
          banner,
          businessUnitLogo,
        },
        stats,
        programMetrics,
      },
      guidelines: {
        policy: cleanText(data.rules),
        policySourceUrl: "",
        scopeDescription: "",
        outOfScopeDescription: "",
        accountAccess: cleanText(data.account_access),
        qualifyingVulnerabilities: stringList(data.qualifying_vulnerability),
        nonQualifyingVulnerabilities: stringList(data.non_qualifying_vulnerability),
        testingRequirements: {
          userAgent: cleanText(data.user_agent),
          triagerUserAgent: cleanText(data.ywh_triager_user_agent),
          restrictedIps: stringList(data.restricted_ips),
          vpnRequired: booleanOrNull(data.vpn_active),
          vpnIps: stringList(data.vpn_ips),
          vpnOutboundIps: stringList(data.vpn_outbound_ips),
        },
        programAvailability: {
          disabled: booleanOrNull(data.disabled),
          message: cleanText(data.disable_message),
        },
        systemicIssueRule: {
          enabled: booleanOrNull(data.systemic_issue_rule_enabled),
          grid: scalarObject(data.systemic_issue_rule_grid, ["level1", "level2", "level3", "level4", "level5", "level6"]),
        },
        leakageRule: {
          enabled: booleanOrNull(data.leakage_rule_enabled),
          inScope: scalarObject(data.leakage_rule_grid_in_scope, ["fully_in_scope", "partially_in_scope", "out_of_scope"]),
          outOfScope: scalarObject(data.leakage_rule_grid_out_of_scope, ["fully_in_scope", "partially_in_scope", "out_of_scope"]),
        },
        serviceLevelAgreement: {
          enabled: booleanOrNull(data.sla_enabled),
          grid: scalarObject(data.sla_grid, ["level1", "level2", "level3", "level4", "level5", "level6"]),
        },
        updatedAt: cleanText(data.last_update_at),
        platformStandardsExclusions: [],
        exemplaryStandardsExclusions: [],
        scopeExclusions: [],
      },
      rewards: {
        currency,
        description: "",
        enabled: booleanOrNull(data.bounty),
        giftEnabled: booleanOrNull(data.gift),
        minimumReward: numberOrNull(data.bounty_reward_min),
        maximumReward: numberOrNull(data.bounty_reward_max),
        disclosure: {
          minimum: scalarOrNull(data.disclose_bounty_min_reward),
          average: scalarOrNull(data.disclose_bounty_average_reward),
          maximum: scalarOrNull(data.disclose_bounty_max_reward),
        },
        updatedAt: cleanText(data.last_update_at),
        rows: rewardRows,
      },
      attachments,
      inScope,
      outOfScope,
      notes: [],
    };
  };

  const isProgramData = (value) => value && typeof value === "object" && !Array.isArray(value) &&
    cleanText(value.slug).toLowerCase() === programSlug.toLowerCase() &&
    typeof value.title === "string" && Array.isArray(value.scopes);

  const findInStructuredData = (root) => {
    if (!root || typeof root !== "object") return null;
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;

    while (stack.length > 0 && visited < 50_000) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (isProgramData(value)) return value;
      if (depth >= 12) continue;

      const entries = Array.isArray(value)
        ? value.map((child, index) => [String(index), child])
        : Object.entries(value);
      for (const [key, child] of entries) {
        if (/(auth|cookie|credential|csrf|jwt|secret|token)/i.test(key)) continue;
        if (child && typeof child === "object") {
          stack.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return null;
  };

  const findInAngularContext = (root) => {
    if (!root || typeof root !== "object") return null;
    const stack = [root];
    const seen = new WeakSet();
    let visited = 0;

    while (stack.length > 0 && visited < 10_000) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (isProgramData(value)) return value;

      const directProgram = Object.getOwnPropertyDescriptor(value, "program")?.value;
      if (isProgramData(directProgram)) return directProgram;
      const programStore = Object.getOwnPropertyDescriptor(value, "programStore")?.value;
      if (programStore && typeof programStore === "object") {
        try {
          if (isProgramData(programStore.program)) return programStore.program;
        } catch {
          // Ignore inaccessible framework state.
        }
      }

      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object") stack.push(child);
        }
      }
    }
    return null;
  };

  const findPageProgram = () => {
    if (typeof document === "undefined") return null;

    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const source = script.textContent || "";
      if (!source || source.length > 6_000_000) continue;
      try {
        const program = findInStructuredData(JSON.parse(source));
        if (program) return program;
      } catch {
        // Ignore unrelated or malformed embedded state.
      }
    }

    const hosts = document.querySelectorAll(
      "ywh-program-public-view, ywh-program-details, #program-public-view",
    );
    for (const host of hosts) {
      try {
        const component = globalThis.ng?.getComponent?.(host);
        const program = findInAngularContext(component);
        if (program) return program;
      } catch {
        // Angular debug helpers are optional in production builds.
      }

      for (const key of Object.getOwnPropertyNames(host)) {
        if (!key.startsWith("__ngContext__")) continue;
        const program = findInAngularContext(host[key]);
        if (program) return program;
      }
    }
    return null;
  };

  if (location.protocol !== "https:" || location.hostname !== "yeswehack.com") {
    return Promise.resolve({ ok: false, error: "Open a YesWeHack program page and try again." });
  }

  const pageProgram = findPageProgram();
  if (pageProgram?.public === false) {
    return Promise.resolve({
      ok: false,
      error: "YesWeHack support is work in progress and currently limited to public programs.",
    });
  }
  if (pageProgram) {
    try {
      return Promise.resolve({ ok: true, data: buildResult(pageProgram) });
    } catch {
      // Fall back to the public endpoint if embedded state changes shape.
    }
  }

  const endpoint = `https://api.yeswehack.com/programs/${encodeURIComponent(programSlug)}`;
  return fetch(endpoint, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (response.status === 401 || response.status === 403) {
      throw new Error("YesWeHack denied the public program request. Confirm that this program is publicly viewable.");
    }
    if (response.status === 404) {
      const currentPageProgram = findPageProgram();
      if (currentPageProgram?.public === false) {
        throw new Error("YesWeHack support is work in progress and currently limited to public programs.");
      }
      if (currentPageProgram) return buildResult(currentPageProgram);
      throw new Error("YesWeHack could not access this program. The work-in-progress adapter currently supports public programs only.");
    }
    if (!response.ok) {
      throw new Error(`YesWeHack returned HTTP ${response.status} while loading this program.`);
    }
    return buildResult(await response.json());
  }).then((data) => ({ ok: true, data })).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not extract this YesWeHack program's scope.",
  }));
}

function getProgramSlug(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "yeswehack.com") return "";
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length !== 2 || segments[0] !== "programs") return "";
    return /^[a-z0-9_-]+$/i.test(segments[1]) ? segments[1] : "";
  } catch {
    return "";
  }
}

const yeswehack = {
  id: "yeswehack",
  label: "YesWeHack (WIP)",

  matches(url) {
    return Boolean(getProgramSlug(url));
  },

  async extract(context) {
    const programSlug = getProgramSlug(context.url);
    if (!programSlug) {
      throw new Error("Open a YesWeHack program page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractYesWeHackPage,
      args: [programSlug],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this YesWeHack program's scope.");
    }
    return result.data;
  },
};

export default yeswehack;
