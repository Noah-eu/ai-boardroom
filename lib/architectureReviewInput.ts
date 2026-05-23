import { OutputType } from '@/types';

export type ArchitectureWebsiteFacts = {
  sourceUrl?: string | null;
  headings?: string[];
  bodyTextBlocks?: string[];
  serviceNames?: string[];
  pricingFields?: string[];
  ctaTexts?: string[];
  emails?: string[];
  phones?: string[];
  addresses?: string[];
};

export type NormalizeArchitectureReviewInputParams = {
  projectName: string;
  outputType: OutputType;
  projectDescription: string;
  projectPrompt: string;
  revisionPrompt?: string | null;
  debateSummary?: string | null;
  websiteFacts?: ArchitectureWebsiteFacts;
  maxChars?: number;
};

export type NormalizeArchitectureReviewInputResult = {
  normalizedInput: string;
  stats: {
    rawChars: number;
    normalizedChars: number;
    droppedDuplicates: number;
    keptFactLines: number;
  };
};

const DEFAULT_MAX_CHARS = 4200;

function normalizeLineForKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, 'url')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitIntoLines(value: string, maxLineChars = 160): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length >= 3)
    .map((line) => (line.length > maxLineChars ? `${line.slice(0, maxLineChars)}...` : line));
}

function uniqLines(lines: string[]): { lines: string[]; dropped: number } {
  const out: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const line of lines) {
    const key = normalizeLineForKey(line);
    if (!key) continue;
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    out.push(line);
  }

  return { lines: out, dropped };
}

function trimSection(lines: string[], maxItems: number): string[] {
  return lines.slice(0, maxItems);
}

function boundedJoin(sections: string[], maxChars: number): string {
  const joined = sections.filter(Boolean).join('\n\n').trim();
  if (joined.length <= maxChars) return joined;

  const cut = joined.lastIndexOf('\n', maxChars - 50);
  if (cut > 0) return `${joined.slice(0, cut)}\n\n[truncated for reliability]`;
  return `${joined.slice(0, maxChars - 28)}\n[truncated for reliability]`;
}

export function normalizeArchitectureReviewInput(
  params: NormalizeArchitectureReviewInputParams
): NormalizeArchitectureReviewInputResult {
  const maxChars = Math.max(1800, params.maxChars ?? DEFAULT_MAX_CHARS);
  const rawCombined = [
    params.projectDescription,
    params.projectPrompt,
    params.revisionPrompt ?? '',
    params.debateSummary ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const intentLinesRaw = splitIntoLines(`${params.projectDescription}\n${params.projectPrompt}`, 170);
  const revisionLinesRaw = splitIntoLines(params.revisionPrompt ?? '', 170);
  const debateLinesRaw = splitIntoLines(params.debateSummary ?? '', 170);

  const factLinesRaw = [
    ...(params.websiteFacts?.sourceUrl ? [`source url: ${params.websiteFacts.sourceUrl}`] : []),
    ...((params.websiteFacts?.headings ?? []).map((entry) => `heading: ${entry}`)),
    ...((params.websiteFacts?.serviceNames ?? []).map((entry) => `service: ${entry}`)),
    ...((params.websiteFacts?.pricingFields ?? []).map((entry) => `pricing: ${entry}`)),
    ...((params.websiteFacts?.emails ?? []).map((entry) => `email: ${entry}`)),
    ...((params.websiteFacts?.phones ?? []).map((entry) => `phone: ${entry}`)),
    ...((params.websiteFacts?.addresses ?? []).map((entry) => `address: ${entry}`)),
    ...((params.websiteFacts?.ctaTexts ?? []).map((entry) => `cta: ${entry}`)),
    ...((params.websiteFacts?.bodyTextBlocks ?? []).map((entry) => `fact: ${entry}`)),
  ].map((line) => compactWhitespace(line));

  const intentDedup = uniqLines(intentLinesRaw);
  const revisionDedup = uniqLines(revisionLinesRaw);
  const debateDedup = uniqLines(debateLinesRaw);
  const factsDedup = uniqLines(factLinesRaw);

  const taskIntent = trimSection(intentDedup.lines, 10);
  const revisionFocus = trimSection(revisionDedup.lines, 6);
  const debateSignals = trimSection(debateDedup.lines, 6);
  const structuredFacts = trimSection(factsDedup.lines, 18);

  const sections = [
    '## Architecture Input (normalized)',
    [
      '### Objective',
      `- project: ${compactWhitespace(params.projectName)}`,
      `- output type: ${params.outputType}`,
      '- artifact: architecture-review.md',
      '- reliability mode: normalized-and-bounded',
    ].join('\n'),
    [
      '### Task Intent',
      ...(taskIntent.length > 0 ? taskIntent.map((line) => `- ${line}`) : ['- none']),
    ].join('\n'),
    [
      '### Structured Facts Handoff',
      ...(structuredFacts.length > 0 ? structuredFacts.map((line) => `- ${line}`) : ['- none']),
    ].join('\n'),
    [
      '### Revision Focus',
      ...(revisionFocus.length > 0 ? revisionFocus.map((line) => `- ${line}`) : ['- none']),
    ].join('\n'),
    [
      '### Debate Signals',
      ...(debateSignals.length > 0 ? debateSignals.map((line) => `- ${line}`) : ['- none']),
    ].join('\n'),
    [
      '### Constraints',
      '- prefer deterministic file-level architecture',
      '- avoid duplicated requirement restatements',
      '- keep assumptions explicit and testable',
    ].join('\n'),
  ];

  const normalizedInput = boundedJoin(sections, maxChars);

  return {
    normalizedInput,
    stats: {
      rawChars: rawCombined.length,
      normalizedChars: normalizedInput.length,
      droppedDuplicates: intentDedup.dropped + revisionDedup.dropped + debateDedup.dropped + factsDedup.dropped,
      keptFactLines: structuredFacts.length,
    },
  };
}
