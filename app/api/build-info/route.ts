import { execSync } from 'node:child_process';
import { NextResponse } from 'next/server';

function readGit(command: string, fallback: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

export async function GET() {
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ??
    readGit('git rev-parse --abbrev-ref HEAD', 'unknown');

  const commitFull =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    readGit('git rev-parse --short HEAD', 'unknown');

  return NextResponse.json({
    branch,
    commit: commitFull.slice(0, 7),
  });
}
