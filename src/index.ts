import { debug, getInput, info, setFailed, warning } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'
import parseGitDiff from 'parse-git-diff'

import type {
  AddedLine,
  AnyLineChange,
  DeletedLine,
  EditRun,
  GetReviewComment,
  LogOptions,
  PartitionResult,
  PullRequestEvent,
  PullRequestFile,
  PullRequestFilePatch,
  ReviewCommentDraft,
  ReviewCommentInput,
  ReviewEvent,
  RunConfig,
  RunResult,
  UnchangedLine,
} from './types'

// GitHub's undocumented limit for comments per review.
// Suggestions beyond this limit are left for future workflow runs.
const MAX_COMMENTS_PER_REVIEW = 100

/**
 * Type guard to check if a change is an AddedLine
 */
function isAddedLine(change: AnyLineChange): change is AddedLine {
  return change?.type === 'AddedLine' && typeof change.lineAfter === 'number'
}

/**
 * Type guard to check if a change is a DeletedLine
 */
function isDeletedLine(change: AnyLineChange): change is DeletedLine {
  return change?.type === 'DeletedLine' && typeof change.lineBefore === 'number'
}

/**
 * Type guard to check if a change is an UnchangedLine
 */
function isUnchangedLine(change: AnyLineChange): change is UnchangedLine {
  return (
    change?.type === 'UnchangedLine' &&
    typeof change.lineBefore === 'number' &&
    typeof change.lineAfter === 'number'
  )
}

/**
 * Generate git diff output with consistent flags
 */
export async function getGitDiff(gitArgs: string[]): Promise<string> {
  const result = await getExecOutput(
    'git',
    ['diff', '--unified=1', '--ignore-cr-at-eol', ...gitArgs],
    { silent: true, ignoreReturnCode: true }
  )
  return result.stdout
}

/**
 * Create a suggestion fenced block.
 */
export function createSuggestion(content: string): string {
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${content}\n\`\`\`\``
}

/**
 * Format a line range for logging: "start-end" for multi-line, or the single line number.
 * startLine is undefined for single-line suggestions; line is always defined.
 */
function formatLineRange(startLine: number | undefined, line: number): string {
  return typeof startLine === 'number' && startLine !== line
    ? `${startLine}-${line}`
    : String(line)
}

/**
 * Error shape returned by Octokit for failed REST requests.
 */
interface RequestErrorLike extends Error {
  status: number
  response?: {
    headers?: Record<string, string | number | undefined>
  }
}

/**
 * Check if error has Octokit's REST request error shape.
 */
function isRequestErrorLike(err: unknown): err is RequestErrorLike {
  return (
    err instanceof Error &&
    typeof (err as Partial<RequestErrorLike>).status === 'number'
  )
}

/**
 * Check if error is an API rate limit error (429 or 403 with rate limit message).
 */
function isRateLimitError(err: unknown): err is RequestErrorLike {
  if (!isRequestErrorLike(err)) return false
  if (err.status === 429) return true
  if (err.status === 403 && /rate limit/i.test(String(err.message)))
    return true
  return false
}

/**
 * Log rate limit reset timing when GitHub provides it.
 */
function warnRateLimitReset(err: RequestErrorLike): void {
  const resetTime = err.response?.headers?.['x-ratelimit-reset']
  if (resetTime === undefined) return

  const resetTimestamp = Number(resetTime)
  if (Number.isFinite(resetTimestamp)) {
    const resetDate = new Date(resetTimestamp * 1000)
    warning(`Rate limit will reset at: ${resetDate.toISOString()}`)
  }
}

/**
 * Segment a hunk's changes into edit runs: maximal sequences of consecutive
 * added/deleted lines, in diff order. Each run is one minimal contiguous
 * edit. The unchanged lines immediately before and after each run are
 * recorded so pure insertions can anchor an existing line (the diff is
 * generated with --unified=1, so a context line is present except at file
 * boundaries). Marker lines such as "\ No newline at end of file" are
 * ignored and do not interrupt a run.
 */
function collectEditRuns(changes: AnyLineChange[]): EditRun[] {
  const runs: EditRun[] = []
  let currentRun: EditRun | null = null
  let lastContext: UnchangedLine | undefined

  for (const change of changes) {
    if (isUnchangedLine(change)) {
      if (currentRun) {
        currentRun.followingContext = change
        currentRun = null
      }
      lastContext = change
    } else if (isAddedLine(change) || isDeletedLine(change)) {
      if (!currentRun) {
        currentRun = {
          changes: [],
          precedingContext: lastContext,
          followingContext: undefined,
        }
        runs.push(currentRun)
      }
      currentRun.changes.push(change)
    }
  }

  return runs
}

/**
 * Check if a run is a pure insertion (only added lines).
 */
function isPureInsertion(run: EditRun): boolean {
  return run.changes.every(isAddedLine)
}

/**
 * Check if a run is a pure deletion (only deleted lines).
 */
function isPureDeletion(run: EditRun): boolean {
  return run.changes.every(isDeletedLine)
}

/**
 * Build the suggestion draft for a contiguous slice of hunk changes: the
 * anchored range is the slice's before-file lines (deleted and unchanged),
 * and the body is the slice's after-file content (added and unchanged lines,
 * in diff order). Every draft this action produces is an instance of this
 * rule, which is what guarantees a suggestion applies to exactly the
 * after-file content of its range.
 *
 * Returns null when the slice contains no before-file line to anchor.
 */
function draftForSlice(
  path: string,
  slice: (AddedLine | DeletedLine | UnchangedLine)[]
): ReviewCommentDraft | null {
  const beforeLines = slice.filter(
    (change): change is DeletedLine | UnchangedLine =>
      isDeletedLine(change) || isUnchangedLine(change)
  )
  const firstBefore = beforeLines.at(0)
  const lastBefore = beforeLines.at(-1)
  if (!firstBefore || !lastBefore) return null

  const body = slice
    .filter((change) => isAddedLine(change) || isUnchangedLine(change))
    .map((change) => change.content)

  return {
    path,
    body: createSuggestion(body.join('\n')),
    line: lastBefore.lineBefore,
    ...(firstBefore.lineBefore !== lastBefore.lineBefore && {
      start_line: firstBefore.lineBefore,
      start_side: 'RIGHT' as const,
    }),
  }
}

/**
 * Build a review comment draft for a single edit run.
 *
 * Runs with deletions anchor exactly the deleted lines. Pure insertions
 * cannot target zero lines on GitHub, so they widen the slice by one
 * adjacent unchanged line, whose content the body then preserves: the line
 * before the insertion point by default, or the line after it when the
 * insertion is at the top of the file. Returns null when there is no
 * existing line to anchor (empty before-file).
 */
function buildCommentDraft(
  path: string,
  run: EditRun
): ReviewCommentDraft | null {
  if (!isPureInsertion(run)) return draftForSlice(path, run.changes)

  if (run.precedingContext) {
    return draftForSlice(path, [run.precedingContext, ...run.changes])
  }
  if (run.followingContext) {
    return draftForSlice(path, [...run.changes, run.followingContext])
  }

  debug(
    `Skipping insertion in ${path}: no existing line to anchor a suggestion to (empty file)`
  )
  return null
}

/**
 * Merge two runs separated by exactly one unchanged line (they share the
 * same context object) into a single draft covering both, in two cases:
 *
 * - Adjacent-line moves: one run purely deletes lines, the other purely
 *   inserts identical content — the pattern linters produce when inserting
 *   a blank line before existing content. Merging keeps the move atomic;
 *   applied separately, the deletion alone would drop the moved content.
 * - Anchor collisions: an insertion at the top of the file falls back to
 *   anchoring its following context line, which the insertion right after
 *   that line anchors too. Merging avoids two suggestions for one line.
 *
 * Returns null when the runs do not qualify.
 */
function tryMergeRuns(
  path: string,
  runA: EditRun,
  runB: EditRun
): ReviewCommentDraft | null {
  const between = runA.followingContext
  if (!between || between !== runB.precedingContext) return null

  const deleteRun = isPureDeletion(runA) ? runA : isPureDeletion(runB) ? runB : null
  const insertRun = isPureInsertion(runA) ? runA : isPureInsertion(runB) ? runB : null
  const isIdenticalMove =
    deleteRun !== null &&
    insertRun !== null &&
    deleteRun.changes.length === insertRun.changes.length &&
    deleteRun.changes.every(
      (change, i) => change.content === insertRun.changes[i]?.content
    )

  const anchorsCollide =
    isPureInsertion(runA) && !runA.precedingContext && isPureInsertion(runB)

  if (!isIdenticalMove && !anchorsCollide) return null
  return draftForSlice(path, [...runA.changes, between, ...runB.changes])
}

/**
 * Build review comment drafts for all edit runs in a hunk, merging
 * neighboring runs when they qualify (see tryMergeRuns).
 */
function buildCommentDraftsForHunk(
  path: string,
  changes: AnyLineChange[]
): ReviewCommentDraft[] {
  const runs = collectEditRuns(changes)
  const drafts: ReviewCommentDraft[] = []

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    if (!run) continue

    const nextRun = runs[i + 1]
    const merged = nextRun && tryMergeRuns(path, run, nextRun)
    if (merged) {
      drafts.push(merged)
      i++
      continue
    }

    const draft = buildCommentDraft(path, run)
    if (draft) drafts.push(draft)
  }

  return drafts
}

/**
 * Function to generate a unique key for a comment
 */
export const generateCommentKey = (
  comment: ReviewCommentInput | GetReviewComment
): string =>
  `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${
    comment.body
  }`

/**
 * Sort comments bottom-up (higher lines before lower lines) per file so
 * batched suggestion application does not shift the anchors of suggestions
 * that have not been applied yet.
 */
export function sortCommentsForBatch(
  comments: ReviewCommentDraft[]
): ReviewCommentDraft[] {
  return comments.toSorted((a, b) => {
    const pathCompare = a.path.localeCompare(b.path)
    if (pathCompare !== 0) return pathCompare

    const lineCompare = b.line - a.line
    if (lineCompare !== 0) return lineCompare

    const aStart = a.start_line ?? a.line
    const bStart = b.start_line ?? b.line
    return bStart - aStart
  })
}

/**
 * Partition an array into two arrays based on a predicate.
 */
function partition<T>(
  items: T[],
  predicate: (item: T) => boolean
): PartitionResult<T> {
  const pass: T[] = []
  const fail: T[] = []
  items.forEach((item) => {
    ;(predicate(item) ? pass : fail).push(item)
  })
  return { pass, fail }
}

/**
 * Generate GitHub review comments from a parsed diff (exported for testing)
 */
export function generateReviewComments(
  parsedDiff: ReturnType<typeof parseGitDiff>,
  existingCommentKeys: Set<string> = new Set()
): ReviewCommentDraft[] {
  const drafts: ReviewCommentDraft[] = []
  for (const file of parsedDiff.files) {
    if (file.type !== 'ChangedFile') continue
    for (const chunk of file.chunks) {
      if (chunk.type !== 'Chunk') continue
      drafts.push(...buildCommentDraftsForHunk(file.path, chunk.changes))
    }
  }

  // Log all generated suggestions with detailed debug info
  if (drafts.length) {
    logComments('Generated suggestions:', drafts, {
      logger: debug,
      detailed: true,
    })
  } else {
    debug('Generated suggestions: 0')
  }

  const seenKeys = new Set<string>()
  const { pass: unique, fail: skipped } = partition(drafts, (draft) => {
    const key = generateCommentKey(draft)
    if (existingCommentKeys.has(key) || seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })
  if (skipped.length) {
    logComments(
      'Suggestions skipped because they would duplicate existing suggestions:',
      skipped
    )
  }
  return unique
}

type RightSideAnchors = Map<string, Set<number> | null>

/**
 * Parse the right-side lines and change counts from a unified diff patch.
 * Returns null for malformed or unsupported patches.
 */
function parsePatchAnchors(patch: string): {
  lines: Set<number>
  additions: number
  deletions: number
} | null {
  let parsedPatch: ReturnType<typeof parseGitDiff>
  try {
    parsedPatch = parseGitDiff(
      `diff --git a/file b/file\n--- a/file\n+++ b/file\n${patch}`
    )
  } catch {
    return null
  }

  const file = parsedPatch.files[0]
  if (parsedPatch.files.length !== 1 || file?.type !== 'ChangedFile') {
    return null
  }

  const lines = new Set<number>()
  let additions = 0
  let deletions = 0

  for (const chunk of file.chunks) {
    if (chunk.type !== 'Chunk') return null

    const beforeLines = chunk.changes.filter(
      (change) => isDeletedLine(change) || isUnchangedLine(change)
    ).length
    const afterLines = chunk.changes.filter(
      (change) => isAddedLine(change) || isUnchangedLine(change)
    ).length
    if (
      beforeLines !== chunk.fromFileRange.lines ||
      afterLines !== chunk.toFileRange.lines
    ) {
      return null
    }

    for (const change of chunk.changes) {
      if (isAddedLine(change)) {
        lines.add(change.lineAfter)
        additions++
      } else if (isDeletedLine(change)) {
        deletions++
      } else if (isUnchangedLine(change)) {
        lines.add(change.lineAfter)
      }
    }
  }

  return { lines, additions, deletions }
}

/**
 * Build valid right-side line numbers from the paginated pull request file
 * patches. A null value means the file belongs to the pull request but its
 * patch is unavailable or incomplete, so line-level validation is skipped.
 */
function buildRightSideAnchors(
  pullRequestFiles: PullRequestFilePatch[]
): RightSideAnchors {
  const anchors: RightSideAnchors = new Map()

  for (const file of pullRequestFiles) {
    const parsed =
      file.patch === undefined ? null : parsePatchAnchors(file.patch)
    const complete =
      parsed !== null &&
      parsed.additions === file.additions &&
      parsed.deletions === file.deletions

    if (complete) {
      anchors.set(file.filename, parsed.lines)
      continue
    }

    if (file.additions === 0 && file.deletions === 0) {
      anchors.set(file.filename, new Set())
      continue
    }

    debug(
      `PR diff filter: patch for ${file.filename} is unavailable or incomplete; ` +
        'skipping line-level validation for this file.'
    )
    anchors.set(file.filename, null)
  }

  return anchors
}

/**
 * Determine if a review comment draft is valid within the PR diff.
 */
function isValidSuggestion(
  comment: ReviewCommentDraft,
  anchors: RightSideAnchors
): boolean {
  const validLines = anchors.get(comment.path)
  if (validLines === undefined) return false
  if (validLines === null) return true
  // GitHub requires the entire commented range to be part of the diff, so
  // check every line in the range, not just the endpoints.
  for (let line = comment.start_line ?? comment.line; line <= comment.line; line++) {
    if (!validLines.has(line)) return false
  }
  return true
}

/**
 * Log review comment drafts with optional detailed output.
 */
function logComments(
  header: string,
  comments: ReviewCommentDraft[],
  { logger = info, detailed = false }: LogOptions = {}
): void {
  if (!comments.length) return

  logger(`${header} ${comments.length}`)

  for (const comment of comments) {
    if (detailed) {
      logger(`- Draft review comment:`)
      logger(`  path: ${comment.path}`)
      logger(`  line: ${comment.line}`)
      if (comment.start_line !== undefined) {
        logger(`  start_line: ${comment.start_line}`)
      }
      if (comment.start_side !== undefined) {
        logger(`  start_side: ${comment.start_side}`)
      }
      logger(`  body:`)
      const indentedBody = comment.body
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')
      logger(indentedBody)
    } else {
      logger(
        `- ${comment.path}:${formatLineRange(comment.start_line, comment.line)}`
      )
    }
  }
}

/**
 * Filter draft comments to files and lines in the pull request. The paginated
 * file endpoint covers up to GitHub's 3,000-file limit, unlike the raw pull
 * request diff, which is capped at 300 files. Comments for files whose patch is
 * unavailable or incomplete are retained because their lines cannot be checked
 * reliably.
 */
function filterSuggestionsInPullRequestDiff({
  pullRequestFiles,
  comments,
}: {
  pullRequestFiles: PullRequestFilePatch[]
  comments: ReviewCommentDraft[]
}): ReviewCommentDraft[] {
  const rightSideAnchors = buildRightSideAnchors(pullRequestFiles)
  const { pass: valid, fail: skipped } = partition(comments, (comment) =>
    isValidSuggestion(comment, rightSideAnchors)
  )
  logComments(
    'Suggestions skipped because they are outside the pull request diff:',
    skipped
  )
  return valid
}

/**
 * Create review body with information about omitted suggestions if needed.
 */
function createReviewBodyWithLimitNotice(
  baseBody: string,
  postedComments: number,
  totalComments: number
): string {
  if (totalComments <= postedComments) return baseBody

  const omittedCount = totalComments - postedComments
  const omittedText =
    omittedCount === 1
      ? '1 additional suggestion remains'
      : `${omittedCount} additional suggestions remain`
  const limitInfo =
    `\n\n> [!NOTE]\n> Posted ${postedComments} of ${totalComments} suggestions. ` +
    `${omittedText}. Rerun the workflow (or push a new commit) to post the next batch.`

  return baseBody ? `${baseBody}${limitInfo}` : limitInfo.trim()
}

/**
 * Main execution function for the GitHub Action
 */
export async function run({
  octokit,
  owner,
  repo,
  pull_number,
  commit_id,
  diff,
  pullRequestFiles,
  event,
  body,
}: RunConfig): Promise<RunResult> {
  debug(`Diff output: ${diff}`)

  const existingComments: GetReviewComment[] = await octokit.paginate(
    octokit.pulls.listReviewComments,
    { owner, repo, pull_number, per_page: 100 }
  )
  const existingCommentKeys = new Set<string>(
    existingComments.map(generateCommentKey)
  )

  // Parse diff after collecting existing comment keys
  const parsedDiff = parseGitDiff(diff)

  const initialComments = generateReviewComments(
    parsedDiff,
    existingCommentKeys
  )
  const comments = filterSuggestionsInPullRequestDiff({
    pullRequestFiles,
    comments: initialComments,
  })
  if (!comments.length) {
    return { comments: [], reviewCreated: false }
  }

  const reviewComments = comments.slice(0, MAX_COMMENTS_PER_REVIEW)
  // Submit higher lines first (bottom-up) so batched application does not shift the anchors of suggestions yet to be applied.
  const orderedReviewComments = sortCommentsForBatch(reviewComments)
  logComments('Suggestions to be included in review:', orderedReviewComments)

  const reviewBody = createReviewBodyWithLimitNotice(
    body,
    reviewComments.length,
    comments.length
  )

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    commit_id,
    body: reviewBody,
    event,
    comments: orderedReviewComments,
  })
  info(
    `Review created successfully with ${reviewComments.length} suggestion(s).`
  )
  return { comments: reviewComments, reviewCreated: true }
}

// Main entrypoint (only when executed directly)
async function main() {
  const octokit = new Octokit({
    userAgent: 'suggest-changes',
  })

  const repoParts = String(env.GITHUB_REPOSITORY).split('/')
  const owner = repoParts[0]
  const repo = repoParts[1]

  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY must be in format owner/repo')
  }

  const eventPayload: PullRequestEvent = JSON.parse(
    readFileSync(String(env.GITHUB_EVENT_PATH), 'utf8')
  )

  if (!eventPayload?.pull_request) {
    const eventName = String(env.GITHUB_EVENT_NAME)
    throw new Error(
      [
        `This workflow was triggered via ${eventName}.`,
        `The ${eventName} event payload does not include the pull_request data required by this action.`,
        'Run this action on: pull_request or pull_request_target instead.',
      ].join('\n')
    )
  }

  const pull_number = Number(eventPayload.pull_request.number)
  const commit_id = eventPayload.pull_request.head.sha

  // A merge-ref checkout has line numbers that can drift from the pull
  // request head, silently misplacing suggestions or getting them dropped.
  const localHead = (
    await getExecOutput('git', ['rev-parse', 'HEAD'], {
      silent: true,
      ignoreReturnCode: true,
    })
  ).stdout.trim()
  if (localHead && localHead !== commit_id) {
    warning(
      `The checked-out commit (${localHead}) is not the pull request head (${commit_id}). ` +
        'Suggestions may be misplaced or dropped. Check out the pull request head ' +
        '(actions/checkout with ref: ${{ github.event.pull_request.head.sha }}) — see the README.'
    )
  }

  // Keep only the fields needed to select local files and validate suggestion
  // anchors, rather than retaining every API field across thousands of files.
  const pullRequestFiles: PullRequestFilePatch[] = await octokit.paginate(
    octokit.pulls.listFiles,
    { owner, repo, pull_number, per_page: 100 },
    (response) =>
      response.data.map(
        ({ filename, patch, additions, deletions }: PullRequestFile) => ({
          filename,
          additions,
          deletions,
          ...(patch !== undefined && { patch }),
        })
      )
  )

  // Get the diff between the head branch and the base branch (limit to the files in the pull request)
  const diff = await getGitDiff([
    '--',
    ...pullRequestFiles.map((file) => file.filename),
  ])

  // Validate and parse the event input
  const eventInput = (getInput('event') || 'COMMENT').toUpperCase()
  const validEvents: ReadonlyArray<ReviewEvent> = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']
  if (!validEvents.includes(eventInput as ReviewEvent)) {
    throw new Error(
      `Invalid event type: "${eventInput}". Must be one of: ${validEvents.join(', ')}`
    )
  }
  const event = eventInput as ReviewEvent
  const body = getInput('comment') || ''

  await run({
    octokit,
    owner,
    repo,
    pull_number,
    commit_id,
    diff,
    pullRequestFiles,
    event,
    body,
  })
}

// pathToFileURL handles Windows paths (drive letters, backslashes), which a
// naive `file://${path}` template does not.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    if (isRateLimitError(err)) {
      warning(`GitHub API rate limit exceeded: ${err.message}`)
      warnRateLimitReset(err)
      return
    }
    setFailed(err instanceof Error ? err.message : String(err))
  })
}
