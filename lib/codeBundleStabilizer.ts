import { AppLanguage, ExecutionOutputBundle, ExecutionOutputFile, OutputType } from '@/types';

export type CodeGenerationMode =
  | 'landing-page'
  | 'company-website'
  | 'dashboard'
  | 'crud-internal-tool'
  | 'uploader-processor-app'
  | 'small-game-prototype';

function normalizeWebsiteMode(mode: CodeGenerationMode): 'landing-page' | 'company-website' {
  return mode === 'landing-page' ? 'landing-page' : 'company-website';
}

interface ModeInput {
  name: string;
  description: string;
  latestRevisionFeedback?: string | null;
  outputType: OutputType;
}

interface StabilizeInput {
  bundle: ExecutionOutputBundle;
  projectName: string;
  projectDescription: string;
  latestRevisionFeedback?: string | null;
  outputType: OutputType;
  language: AppLanguage;
  sourceUrl?: string | null;
}

interface WebsiteValidationInput {
  files: ExecutionOutputFile[];
  sourceUrl?: string | null;
}

interface WebsiteValidationResult {
  ok: boolean;
  files: ExecutionOutputFile[];
  errors: string[];
}

const ENTRY_POINT_PRIORITY = [
  'index.html',
  'src/main.tsx',
  'src/main.ts',
  'app/page.tsx',
  'main.tsx',
  'main.ts',
  'src/index.tsx',
  'src/index.html',
] as const;

const URL_PLACEHOLDER_PATTERNS = [
  /\[\s*SEM\s+VLOZ\s+URL\s*\]/gi,
  /\[\s*SEM\s+VLOŽ\s+URL\s*\]/gi,
  /\[\s*INSERT\s+URL\s+HERE\s*\]/gi,
  /\{\{\s*URL\s*\}\}/gi,
  /\[\s*TODO\s*:\s*URL\s*\]/gi,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function replaceKnownUrlPlaceholders(value: string, sourceUrl?: string | null): string {
  if (!value) return value;
  if (!sourceUrl?.trim()) return value;
  let next = value;
  URL_PLACEHOLDER_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, sourceUrl.trim());
  });
  return next;
}

function hasKnownUrlPlaceholder(value: string): boolean {
  if (!value) return false;
  return URL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function hasExt(filePath: string, exts: string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function isCodeSourceFile(filePath: string): boolean {
  const lower = normalizePath(filePath).toLowerCase();
  if (!lower) return false;
  if (['readme.md', 'run-instructions.md', 'deploy-instructions.md', 'app-manifest.json', 'site-metadata.json'].includes(lower)) {
    return false;
  }
  return hasExt(lower, ['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json']);
}

function classifyByText(value: string): CodeGenerationMode {
  const normalized = value.toLowerCase();

  if (/\b(game|pong|prototype game|mini game|arcade|platformer)\b/.test(normalized)) {
    return 'small-game-prototype';
  }
  if (/\b(upload|uploader|pdf upload|ingest|processor|processing|convert|converter|pipeline)\b/.test(normalized)) {
    return 'uploader-processor-app';
  }
  if (/\b(crud|internal tool|admin panel|admin app|backoffice|operations tool|workflow tool)\b/.test(normalized)) {
    return 'crud-internal-tool';
  }
  if (/\b(dashboard|analytics|kpi|metrics|reporting)\b/.test(normalized)) {
    return 'dashboard';
  }
  if (/\b(landing page|homepage|hero section|single page)\b/.test(normalized)) {
    return 'landing-page';
  }
  if (/\b(company website|corporate website|business website|agency website|firm website|portfolio website)\b/.test(normalized)) {
    return 'company-website';
  }

  return 'company-website';
}

export function classifyCodeGenerationMode(input: ModeInput): CodeGenerationMode {
  const combined = [input.name, input.description, input.latestRevisionFeedback ?? ''].join(' ').trim();
  const byText = classifyByText(combined);

  if (input.outputType === 'website') {
    return normalizeWebsiteMode(byText);
  }

  if (input.outputType === 'app') {
    if (byText === 'landing-page' || byText === 'company-website') {
      return 'dashboard';
    }
    return byText;
  }

  return byText;
}

export function getModeLabel(mode: CodeGenerationMode): string {
  const labels: Record<CodeGenerationMode, string> = {
    'landing-page': 'landing page',
    'company-website': 'company website',
    dashboard: 'dashboard',
    'crud-internal-tool': 'CRUD/internal tool',
    'uploader-processor-app': 'uploader/processor app',
    'small-game-prototype': 'small game/prototype',
  };
  return labels[mode];
}

export function detectEntryPoint(files: ExecutionOutputFile[]): string {
  const normalized = files.map((file) => normalizePath(file.path));
  for (const candidate of ENTRY_POINT_PRIORITY) {
    if (normalized.includes(candidate)) return candidate;
  }

  const firstSource = normalized.find((path) => isCodeSourceFile(path));
  return firstSource ?? normalized[0] ?? 'index.html';
}

function buildReadme(params: {
  mode: CodeGenerationMode;
  projectName: string;
  projectDescription: string;
  entryPoint: string;
  files: ExecutionOutputFile[];
  language: AppLanguage;
  sourceUrl?: string | null;
}): string {
  const title = params.projectName || 'AI Boardroom Generated Project';
  const sanitizedDescription = replaceKnownUrlPlaceholders(params.projectDescription || '', params.sourceUrl);
  const lines = [
    `# ${title}`,
    '',
    '## Overview',
    sanitizedDescription || 'Generated by AI Boardroom code pipeline.',
    '',
    '## Generation Mode',
    getModeLabel(params.mode),
    '',
    '## Entry Point',
    params.entryPoint,
    '',
    '## Files',
    ...params.files.map((file) => `- ${normalizePath(file.path)}`),
    '',
    '## Run',
    'See run-instructions.md',
    '',
    '## Deploy',
    'See deploy-instructions.md',
  ];
  return lines.join('\n');
}

function buildRunInstructions(entryPoint: string): string {
  return [
    '# Run Instructions',
    '',
    '## Local Preview',
    '1. Ensure all generated files are in one folder preserving paths.',
    '2. Start a static server, for example:',
    '```bash',
    'python3 -m http.server 4173',
    '```',
    '3. Open http://localhost:4173 in your browser.',
    '',
    '## Entry Point',
    entryPoint,
  ].join('\n');
}

function buildDeployInstructions(entryPoint: string): string {
  return [
    '# Deploy Instructions',
    '',
    '## Netlify (static deploy)',
    '1. Upload the generated folder as a new site deploy.',
    '2. Ensure the publish directory points to project root.',
    '',
    '## Vercel (static)',
    '1. Import repository/folder containing generated files.',
    '2. Use static framework preset or no-build static deploy.',
    '',
    '## Required Entry Point',
    entryPoint,
  ].join('\n');
}

function buildManifest(params: {
  mode: CodeGenerationMode;
  entryPoint: string;
  files: ExecutionOutputFile[];
  projectName: string;
}): string {
  const payload = {
    schemaVersion: 1,
    type: 'ai-boardroom-code-bundle',
    generationMode: params.mode,
    entryPoint: params.entryPoint,
    projectName: params.projectName || 'Generated Project',
    sourceFiles: params.files.map((file) => normalizePath(file.path)).filter((path) => isCodeSourceFile(path)),
    generatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildWebsiteMetadata(params: {
  mode: CodeGenerationMode;
  entryPoint: string;
  projectName: string;
  projectDescription: string;
  sourceFiles: ExecutionOutputFile[];
  sourceUrl?: string | null;
}): string {
  const normalizedMode = normalizeWebsiteMode(params.mode);
  const payload = {
    schemaVersion: 1,
    type: 'ai-boardroom-website-metadata',
    mode: normalizedMode,
    outputKind: 'static-web',
    entryPoint: params.entryPoint,
    projectName: params.projectName || 'Generated Website',
    projectDescription: replaceKnownUrlPlaceholders(params.projectDescription || '', params.sourceUrl),
    sourceFiles: params.sourceFiles
      .map((file) => normalizePath(file.path))
      .filter((path) => isCodeSourceFile(path)),
    generatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

function validateIndexHtmlIntegrity(indexHtml: string): string[] {
  const errors: string[] = [];
  const trimmed = indexHtml.trim();

  if (!trimmed) {
    errors.push('index.html is empty.');
    return errors;
  }

  if (trimmed.length < 120) {
    errors.push('index.html is suspiciously short and likely incomplete.');
  }

  if (!/<html\b/i.test(trimmed)) {
    errors.push('index.html is missing <html> root tag.');
  }
  if (!/<body\b/i.test(trimmed)) {
    errors.push('index.html is missing <body> tag.');
  }
  if (!/<\/body>/i.test(trimmed)) {
    errors.push('index.html is missing closing </body> tag.');
  }
  if (!/<\/html>/i.test(trimmed)) {
    errors.push('index.html is missing closing </html> tag.');
  }

  const lower = trimmed.toLowerCase();
  if (/(<[^>]*$)|(\{[^}]*$)/.test(trimmed)) {
    errors.push('index.html appears truncated at the end of a tag/block.');
  }

  const tail = lower.slice(-400);
  if (!tail.includes('</body>') || !tail.includes('</html>')) {
    errors.push('index.html does not end with complete closing structure.');
  }

  const ltCount = (trimmed.match(/</g) ?? []).length;
  const gtCount = (trimmed.match(/>/g) ?? []).length;
  if (ltCount !== gtCount) {
    errors.push('index.html has unbalanced angle brackets, likely malformed/truncated output.');
  }

  return errors;
}

export function validateWebsiteBundleSourceFiles(input: WebsiteValidationInput): WebsiteValidationResult {
  const sourceUrl = input.sourceUrl?.trim() ? input.sourceUrl.trim() : null;
  const normalized = input.files.map((file) => ({
    path: normalizePath(file.path),
    content: replaceKnownUrlPlaceholders(file.content, sourceUrl),
  }));

  const errors: string[] = [];
  const indexFile = normalized.find((file) => file.path.toLowerCase() === 'index.html');
  const stylesFile = normalized.find((file) => file.path.toLowerCase() === 'styles.css');

  if (!indexFile || !indexFile.content.trim()) {
    errors.push('Required file index.html is missing or empty.');
  }
  if (!stylesFile || !stylesFile.content.trim()) {
    errors.push('Required file styles.css is missing or empty.');
  }

  if (indexFile?.content) {
    errors.push(...validateIndexHtmlIntegrity(indexFile.content));
  }

  const unresolvedPlaceholders = normalized
    .filter((file) => hasKnownUrlPlaceholder(file.content))
    .map((file) => file.path);
  if (unresolvedPlaceholders.length > 0 && sourceUrl) {
    errors.push(
      `Unresolved URL placeholders remain in files: ${unresolvedPlaceholders.join(', ')}.`
    );
  }

  return {
    ok: errors.length === 0,
    files: normalized,
    errors,
  };
}

function upsertFile(files: ExecutionOutputFile[], path: string, content: string): ExecutionOutputFile[] {
  const normalizedPath = normalizePath(path);
  const next = [...files];
  const index = next.findIndex((file) => normalizePath(file.path) === normalizedPath);
  if (index >= 0) {
    next[index] = { path: normalizedPath, content: next[index].content || content };
    return next;
  }
  next.push({ path: normalizedPath, content });
  return next;
}

export function stabilizeCodeExecutionBundle(input: StabilizeInput): {
  bundle: ExecutionOutputBundle;
  mode: CodeGenerationMode;
  entryPoint: string;
} {
  const mode = classifyCodeGenerationMode({
    name: input.projectName,
    description: input.projectDescription,
    latestRevisionFeedback: input.latestRevisionFeedback,
    outputType: input.outputType,
  });

  let files = input.bundle.files.map((file) => ({ path: normalizePath(file.path), content: file.content }));
  const entryPoint = detectEntryPoint(files);

  files = upsertFile(
    files,
    'README.md',
    buildReadme({
      mode,
      projectName: input.projectName,
      projectDescription: input.projectDescription,
      entryPoint,
      files,
      language: input.language,
      sourceUrl: input.sourceUrl,
    })
  );
  files = upsertFile(files, 'run-instructions.md', buildRunInstructions(entryPoint));
  files = upsertFile(files, 'deploy-instructions.md', buildDeployInstructions(entryPoint));
  files = upsertFile(
    files,
    'app-manifest.json',
    buildManifest({
      mode,
      entryPoint,
      files,
      projectName: input.projectName,
    })
  );
  if (input.outputType === 'website') {
    files = upsertFile(
      files,
      'site-metadata.json',
      buildWebsiteMetadata({
        mode,
        entryPoint,
        projectName: input.projectName,
        projectDescription: input.projectDescription,
        sourceFiles: files,
        sourceUrl: input.sourceUrl,
      })
    );
  }

  const notes = Array.from(
    new Set([
      ...(input.bundle.notes ?? []),
      'Code bundle stabilized with deterministic packaging contract (README/run/deploy/manifest).',
    ])
  );

  const summary = `${input.bundle.summary} [mode=${mode}; entry=${entryPoint}; files=${files.length}]`;

  return {
    bundle: {
      ...input.bundle,
      summary,
      files,
      notes,
    },
    mode,
    entryPoint,
  };
}

export function buildDeterministicCodePackagingNotes(params: {
  bundle: ExecutionOutputBundle;
  mode: CodeGenerationMode;
  entryPoint: string;
}): string {
  const sourceFiles = params.bundle.files
    .map((file) => normalizePath(file.path))
    .filter((path) => isCodeSourceFile(path));

  return [
    '# Bundle Packaging Notes',
    '',
    `- Generation mode: ${getModeLabel(params.mode)}`,
    `- Entry point: ${params.entryPoint}`,
    `- Source file count: ${sourceFiles.length}`,
    `- Total file count: ${params.bundle.files.length}`,
    '',
    '## Contract Files',
    '- README.md',
    '- run-instructions.md',
    '- deploy-instructions.md',
    '- app-manifest.json',
    '',
    '## Source Set',
    ...sourceFiles.map((path) => `- ${path}`),
  ].join('\n');
}

export function buildDeterministicCodeFinalSummary(params: {
  bundle: ExecutionOutputBundle;
  mode: CodeGenerationMode;
  entryPoint: string;
  reviewNotes?: string | null;
  packagingNotes?: string | null;
}): string {
  const lines = [
    '# Final Summary',
    '',
    `Generation mode: ${getModeLabel(params.mode)}`,
    `Entry point: ${params.entryPoint}`,
    `Generated files: ${params.bundle.files.length}`,
    '',
    'The preview and exported bundle use the same generated source set from generated-files.json.',
  ];

  if (params.reviewNotes?.trim()) {
    lines.push('', '## Reviewer Notes', params.reviewNotes.trim());
  }

  if (params.packagingNotes?.trim()) {
    lines.push('', '## Packaging Notes', params.packagingNotes.trim());
  }

  return lines.join('\n');
}
