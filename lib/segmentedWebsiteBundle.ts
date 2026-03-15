import { ExecutionOutputBundle, ExecutionOutputFile } from '@/types';
import { validateWebsiteBundleSourceFiles } from './codeBundleStabilizer';
import { validatePublicWebsiteHtml } from './deterministicWebsiteBuilder';

export type SegmentedWebsiteBundleInput = {
  indexHtml: string | null;
  stylesCss: string | null;
  scriptJsRaw: string | null;
  noScriptMarker: string;
  sourceUrl?: string | null;
  rawProjectPrompt?: string | null;
  portraitRequirement?: {
    assetPath: string;
    materializedFile: ExecutionOutputFile | null;
  } | null;
};

export type SegmentedWebsiteBundleResult =
  | {
      ok: true;
      bundle: ExecutionOutputBundle;
    }
  | {
      ok: false;
      error: string;
    };

export function assembleSegmentedWebsiteSeedBundle(
  input: SegmentedWebsiteBundleInput
): SegmentedWebsiteBundleResult {
  const indexHtml = input.indexHtml?.trim() ?? '';
  const stylesCss = input.stylesCss?.trim() ?? '';

  if (!indexHtml) {
    return {
      ok: false,
      error: 'segmented website bundle assembly requires non-empty index.html.',
    };
  }

  if (!stylesCss) {
    return {
      ok: false,
      error: 'segmented website bundle assembly requires non-empty styles.css.',
    };
  }

  if (input.portraitRequirement) {
    if (!input.portraitRequirement.materializedFile) {
      return {
        ok: false,
        error: 'approved portrait image could not be materialized into deployable bundle asset.',
      };
    }

    if (!indexHtml.includes(input.portraitRequirement.assetPath)) {
      return {
        ok: false,
        error: `index.html is missing required portrait asset reference (${input.portraitRequirement.assetPath}).`,
      };
    }
  }

  const publicHtmlErrors = validatePublicWebsiteHtml(indexHtml, input.rawProjectPrompt);
  if (publicHtmlErrors.length > 0) {
    return {
      ok: false,
      error: `generated public HTML failed sanitization checks: ${publicHtmlErrors.join(' | ')}`,
    };
  }

  const includeScript = Boolean(
    input.scriptJsRaw?.trim() && input.scriptJsRaw.trim() !== input.noScriptMarker
  );

  const sourceValidation = validateWebsiteBundleSourceFiles({
    files: [
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      ...(includeScript ? [{ path: 'script.js', content: input.scriptJsRaw as string }] : []),
      ...(input.portraitRequirement?.materializedFile
        ? [input.portraitRequirement.materializedFile]
        : []),
    ],
    sourceUrl: input.sourceUrl,
  });

  if (!sourceValidation.ok) {
    return {
      ok: false,
      error: `segmented website artifacts failed integrity validation: ${sourceValidation.errors.join(' | ')}`,
    };
  }

  return {
    ok: true,
    bundle: {
      status: 'success',
      summary: 'Segmented website artifacts assembled into deterministic bundle.',
      files: sourceValidation.files,
      notes: [
        'generated-files.json assembled locally from segmented website artifacts (index/styles/script).',
        includeScript ? 'script.js included.' : 'script.js omitted (no script needed).',
        ...(input.portraitRequirement?.materializedFile
          ? [`Portrait asset included: ${input.portraitRequirement.materializedFile.path}.`]
          : []),
      ],
      removePaths: [],
    },
  };
}
