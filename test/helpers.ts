import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../src/index.ts'
import type {
  PullRequestFilePatch,
  ReviewCommentDraft,
} from '../src/types.ts'

/**
 * Build a diff string for a single file from hunk lines.
 */
export function makeDiff(hunkLines: string[], path = 'file.md'): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 0000001..0000002 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunkLines,
    '',
  ].join('\n')
}

/**
 * Build the subset of a pull request file response used for anchor validation.
 */
export function makePullRequestFile(
  hunkLines: string[],
  filename = 'file.md'
): PullRequestFilePatch {
  return {
    filename,
    patch: hunkLines.join('\n'),
    additions: hunkLines.filter((line) => line.startsWith('+')).length,
    deletions: hunkLines.filter((line) => line.startsWith('-')).length,
  }
}

/**
 * Generate review comments for a raw diff string.
 */
export function suggestionsFor(diff: string): ReviewCommentDraft[] {
  return generateReviewComments(parseGitDiff(diff))
}

/**
 * Apply a suggestion to file content (same semantics as GitHub).
 */
export function applySuggestion(
  content: string,
  suggestion: ReviewCommentDraft
): string {
  const lines = content.split('\n')

  // Extract the suggestion body content (remove the ````suggestion wrapper)
  // Use greedy match (not *?) because the suggestion body always includes a newline before the closing ````
  const suggestionMatch = suggestion.body.match(
    /^````suggestion\n([\s\S]*)\n````$/
  )
  if (!suggestionMatch) {
    throw new Error(
      `Invalid suggestion body format. Expected format: \`\`\`\`suggestion\\n<content>\\n\`\`\`\`\n` +
        `Received: ${suggestion.body}`
    )
  }
  const suggestionContent = suggestionMatch[1] ?? ''
  const suggestionLines =
    suggestionContent === '' ? [] : suggestionContent.split('\n')

  // GitHub suggestions use 1-based line numbers; convert to 0-based indices
  const startIndex = (suggestion.start_line ?? suggestion.line) - 1
  const endIndex = suggestion.line - 1

  return [
    ...lines.slice(0, startIndex),
    ...suggestionLines,
    ...lines.slice(endIndex + 1),
  ].join('\n')
}

/**
 * Apply multiple suggestions to file content bottom-up (highest line first)
 * so applying one suggestion doesn't shift line numbers for the others.
 */
export function applySuggestions(
  content: string,
  suggestions: ReviewCommentDraft[]
): string {
  const ordered = [...suggestions].sort(
    (a, b) => (b.start_line ?? b.line) - (a.start_line ?? a.line)
  )
  return ordered.reduce(applySuggestion, content)
}
