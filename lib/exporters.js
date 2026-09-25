function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

function escapeMarkdown(value) {
  return text(value)
    .replace(/\r?\n/g, " ")
    .replace(/([\\`*_\[\]<>])/g, "\\$1");
}

function escapeTableCell(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;")
    .replace(/\r?\n/g, "<br>");
}

function inlineCode(value) {
  const content = text(value)
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const padding = /^`|`$|^ | $/.test(content) ? " " : "";
  return `${fence}${padding}${content}${padding}${fence}`;
}

function bountyLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

function humanizeKey(value) {
  return text(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function displayValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return text(value);
}

function flattenMetadata(value, prefix = "", rows = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return rows;
  for (const [key, child] of Object.entries(value)) {
    const label = prefix ? `${prefix} — ${humanizeKey(key)}` : humanizeKey(key);
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenMetadata(child, label, rows);
    } else if (Array.isArray(child) && child.length > 0 && child.every((item) =>
      item === null || ["string", "number", "boolean"].includes(typeof item))) {
      rows.push([label, child.map(displayValue).join(", ")]);
    } else if (child !== null && child !== undefined && child !== "" && !Array.isArray(child)) {
      rows.push([label, displayValue(child)]);
    }
  }
  return rows;
}

function addMetadataSection(lines, title, value, level = 2) {
  const rows = flattenMetadata(value);
  if (rows.length === 0) return;
  lines.push(`${"#".repeat(level)} ${title}`, "", "| Field | Value |", "|---|---|");
  for (const [label, fieldValue] of rows) {
    lines.push(`| ${escapeTableCell(label)} | ${escapeTableCell(fieldValue)} |`);
  }
  lines.push("");
}

function addTextSection(lines, title, value, level = 3) {
  const content = text(value).trim();
  if (!content) return;
  lines.push(`${"#".repeat(level)} ${title}`, "", content, "");
}

function addListSection(lines, title, values, level = 3) {
  if (!Array.isArray(values) || values.length === 0) return;
  lines.push(`${"#".repeat(level)} ${title}`, "");
  for (const value of values) {
    lines.push(`- ${escapeMarkdown(value)}`);
  }
  lines.push("");
}

function addGuidelines(lines, guidelines = {}) {
  const hasGuidelines = flattenMetadata(guidelines).length > 0 ||
    (guidelines.platformStandardsExclusions?.length || 0) > 0 ||
    (guidelines.exemplaryStandardsExclusions?.length || 0) > 0 ||
    (guidelines.scopeExclusions?.length || 0) > 0;
  if (!hasGuidelines) return;

  lines.push("## Guidelines", "");
  addTextSection(lines, "Policy", guidelines.policy);
  addTextSection(lines, "Scope Description", guidelines.scopeDescription);
  addTextSection(lines, "Out-of-Scope Guidance", guidelines.outOfScopeDescription);
  addTextSection(lines, "FAQ", guidelines.faq);
  addTextSection(lines, "Severity Assessment", guidelines.severityAssessment);
  addTextSection(lines, "Introduction", guidelines.introduction);
  addTextSection(lines, "Disclosure", guidelines.disclosure);
  addTextSection(lines, "Account Access", guidelines.accountAccess);
  addListSection(lines, "Qualifying Vulnerabilities", guidelines.qualifyingVulnerabilities);
  addListSection(lines, "Non-Qualifying Vulnerabilities", guidelines.nonQualifyingVulnerabilities);
  addMetadataSection(lines, "Testing Requirements", guidelines.testingRequirements, 3);

  const {
    policy,
    scopeDescription,
    outOfScopeDescription,
    faq,
    severityAssessment,
    introduction,
    disclosure,
    accountAccess,
    qualifyingVulnerabilities,
    nonQualifyingVulnerabilities,
    testingRequirements,
    platformStandardsExclusions = [],
    exemplaryStandardsExclusions = [],
    scopeExclusions = [],
    ...declarations
  } = guidelines;
  addMetadataSection(lines, "Declarations", declarations, 3);

  if (platformStandardsExclusions.length > 0) {
    lines.push("### Platform Standards Exclusions", "", "| Standard | Justification |", "|---|---|");
    for (const exclusion of platformStandardsExclusions) {
      lines.push(`| ${escapeTableCell(exclusion.standard)} | ${escapeTableCell(exclusion.justification)} |`);
    }
    lines.push("");
  }

  if (exemplaryStandardsExclusions.length > 0) {
    lines.push("### Exemplary Standards Exclusions", "");
    for (const exclusion of exemplaryStandardsExclusions) {
      lines.push(`- ${escapeMarkdown(exclusion)}`);
    }
    lines.push("");
  }

  if (scopeExclusions.length > 0) {
    lines.push("### Scope Exclusions", "", "| Category | Details | Added |", "|---|---|---|");
    for (const exclusion of scopeExclusions) {
      lines.push(
        `| ${escapeTableCell(exclusion.category)} | ${escapeTableCell(exclusion.details)} | ${escapeTableCell(exclusion.createdAt)} |`,
      );
    }
    lines.push("");
  }
}

function formatReward(row, severity, currency) {
  const maximum = row.amounts?.[severity];
  const minimum = row.amounts?.[`${severity}Minimum`];
  if (maximum === null || maximum === undefined) return "";
  const amount = minimum !== null && minimum !== undefined && minimum !== maximum
    ? `${minimum}–${maximum}`
    : String(maximum);
  return currency ? `${amount} ${currency}` : amount;
}

function addRewards(lines, rewards = {}) {
  const { rows = [], tiers = [], description, ...summary } = rewards;
  const hasSummary = flattenMetadata(summary).length > 0;
  if (!description && !hasSummary && rows.length === 0 && tiers.length === 0) return;

  lines.push("## Rewards", "");
  addTextSection(lines, "Reward Guidance", description);
  addMetadataSection(lines, "Reward Metadata", summary, 3);

  if (rows.length > 0) {
    lines.push(
      "### Reward Table",
      "",
      "| Group | Asset | Low | Medium | High | Critical |",
      "|---|---|---|---|---|---|",
    );
    for (const row of rows) {
      lines.push(
        `| ${escapeTableCell(row.name)} | ${row.asset ? inlineCode(row.asset) : ""} | ${escapeTableCell(formatReward(row, "low", rewards.currency))} | ${escapeTableCell(formatReward(row, "medium", rewards.currency))} | ${escapeTableCell(formatReward(row, "high", rewards.currency))} | ${escapeTableCell(formatReward(row, "critical", rewards.currency))} |`,
      );
    }
    lines.push("");
  }

  if (tiers.length > 0) {
    lines.push(
      "### Bounty Tiers",
      "",
      "| Tier | CVSS Score | Minimum | Maximum |",
      "|---|---|---|---|",
    );
    for (const tier of tiers) {
      const ranges = Array.isArray(tier.ranges) ? tier.ranges : [];
      if (ranges.length === 0) {
        lines.push(`| ${escapeTableCell(tier.tier)} |  |  |  |`);
        continue;
      }
      for (const range of ranges) {
        const score = range.minScore === null || range.minScore === undefined
          ? ""
          : `${range.minScore}${range.maxScore === null || range.maxScore === undefined ? "" : `–${range.maxScore}`}`;
        const minimum = range.minBounty === null || range.minBounty === undefined
          ? ""
          : `${range.minBounty}${range.currency ? ` ${range.currency}` : ""}`;
        const maximum = range.maxBounty === null || range.maxBounty === undefined
          ? ""
          : `${range.maxBounty}${range.currency ? ` ${range.currency}` : ""}`;
        lines.push(
          `| ${escapeTableCell(tier.tier)} | ${escapeTableCell(score)} | ${escapeTableCell(minimum)} | ${escapeTableCell(maximum)} |`,
        );
      }
    }
    lines.push("");
  }
}

function addAttachments(lines, attachments = []) {
  if (attachments.length === 0) return;
  const includeSection = attachments.some((attachment) => attachment.section);
  const headers = ["File", "Content Type", "Size (bytes)"];
  if (includeSection) headers.unshift("Section");
  lines.push(
    "## Policy Attachments",
    "",
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
  );
  for (const attachment of attachments) {
    const cells = [attachment.fileName, attachment.contentType, attachment.fileSize];
    if (includeSection) cells.unshift(attachment.section);
    lines.push(
      `| ${cells.map(escapeTableCell).join(" | ")} |`,
    );
  }
  lines.push("");
}

function scopeColumns(entries, inScope) {
  const columns = [
    { heading: "Asset", value: (entry) => inlineCode(entry.asset), escaped: true },
    { heading: "Type", value: (entry) => entry.type },
  ];
  const optional = [
    { heading: "Group", key: "group", value: (entry) => entry.group },
    { heading: "Tier", key: "bountyTier", value: (entry) => entry.bountyTier },
    { heading: "Reward Grid", key: "rewardGrid", value: (entry) => entry.rewardGrid },
  ];
  for (const column of optional) {
    if (entries.some((entry) => entry[column.key])) columns.push(column);
  }
  if (inScope) {
    columns.push(
      { heading: "Bounty", value: (entry) => bountyLabel(entry.eligibleForBounty), escaped: true },
      { heading: "Max Severity", value: (entry) => entry.maxSeverity },
    );
  }
  if (entries.some((entry) => Array.isArray(entry.requiredSkills) && entry.requiredSkills.length > 0)) {
    columns.push({ heading: "Required Skills", value: (entry) => entry.requiredSkills?.join(", ") || "" });
  }
  if (entries.some((entry) => entry.source)) {
    columns.push({ heading: "Source", value: (entry) => entry.source });
  }
  if (entries.some((entry) => entry.reportCount !== null && entry.reportCount !== undefined)) {
    columns.push({ heading: "Reports", value: (entry) => entry.reportCount });
  }
  columns.push({ heading: "Notes", value: (entry) => entry.instruction });
  return columns;
}

function addScopeTable(lines, title, entries, inScope) {
  const columns = scopeColumns(entries, inScope);
  lines.push(
    `## ${title}`,
    "",
    `| ${columns.map((column) => column.heading).join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
  );
  for (const entry of entries) {
    const cells = columns.map((column) => {
      const value = column.value(entry);
      return column.escaped ? value : escapeTableCell(value);
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (entries.length === 0) {
    lines.push(`| ${columns.map(() => "").join(" | ")} |`);
  }
}

function addInScope(lines, entries) {
  addScopeTable(lines, "In Scope", entries, true);
}

function addOutOfScope(lines, entries) {
  addScopeTable(lines, "Out of Scope", entries, false);
}

export function toMarkdown(scope, { platformLabel = scope.platform } = {}) {
  const title = scope.program.name || scope.program.handle || "Program Scope";
  const lines = [
    `# ${escapeMarkdown(title)}`,
    "",
    `Platform: ${escapeMarkdown(platformLabel)}`,
    `Program: ${text(scope.program.url).replace(/\r?\n/g, "").replace(/</g, "%3C").replace(/>/g, "%3E")}`,
    "",
  ];

  addMetadataSection(lines, "Program Metadata", {
    website: scope.program.website,
    ...scope.metadata,
  });
  addTextSection(lines, "About", scope.program.about, 2);
  addGuidelines(lines, scope.guidelines);

  addInScope(lines, scope.inScope);
  lines.push("");
  addOutOfScope(lines, scope.outOfScope);
  lines.push("");
  addRewards(lines, scope.rewards);
  addAttachments(lines, scope.attachments);

  if (scope.notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of scope.notes) {
      lines.push(`- ${escapeMarkdown(note)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function toJSON(scope) {
  return JSON.stringify(scope, null, 2);
}

export function exportScope(scope, format, options) {
  return format === "json" ? toJSON(scope) : toMarkdown(scope, options);
}
