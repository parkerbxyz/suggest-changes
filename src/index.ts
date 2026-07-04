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
 * Normalize unknown error-like values to a concise string message.
 */
function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
 * added/deleted lines. Each run is one minimal contiguous edit and maps to
 * exactly one suggestion. The unchanged lines immediately before and after
 * each run are recorded so pure insertions can anchor an existing line
 * (the diff is generated with --unified=1, so a context line is present
 * except at file boundaries). Marker lines such as "\ No newline at end of
 * file" are ignored and do not interrupt a run.
 */
export function collectEditRuns(changes: AnyLineChange[]): EditRun[] {
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
          deletedLines: [],
          addedLines: [],
          precedingContext: lastContext,
          followingContext: undefined,
        }
        runs.push(currentRun)
      }
      if (isDeletedLine(change)) {
        currentRun.deletedLines.push(change)
      } else {
        currentRun.addedLines.push(change)
      }
    }
  }

  return runs
}

/**
 * Check if a run is a pure insertion (no deleted lines).
 */
function isPureInsertion(run: EditRun): boolean {
  return run.deletedLines.length === 0
}

/**
 * Build a review comment draft for an edit run.
 *
 * Runs with deletions replace exactly the deleted line range with the added
 * content (empty suggestion for pure deletions). Pure insertions cannot
 * target zero lines on GitHub, so they anchor one adjacent existing line and
 * include its content in the body: the line before the insertion point by
 * default, or the line after it when the insertion is at the top of the file.
 * Returns null when there is no existing line to anchor (empty before-file).
 */
function buildCommentDraft(
  path: string,
  run: EditRun
): ReviewCommentDraft | null {
  const addedContent = run.addedLines.map((line) => line.content)

  const firstDeleted = run.deletedLines.at(0)
  const lastDeleted = run.deletedLines.at(-1)
  if (firstDeleted && lastDeleted) {
    return {
      path,
      body: createSuggestion(addedContent.join('\n')),
      line: lastDeleted.lineBefore,
      ...(run.deletedLines.length > 1 && {
        start_line: firstDeleted.lineBefore,
        start_side: 'RIGHT' as const,
      }),
    }
  }

  if (run.precedingContext) {
    return {
      path,
      body: createSuggestion(
        [run.precedingContext.content, ...addedContent].join('\n')
      ),
      line: run.precedingContext.lineBefore,
    }
  }

  if (run.followingContext) {
    return {
      path,
      body: createSuggestion(
        [...addedContent, run.followingContext.content].join('\n')
      ),
      line: run.followingContext.lineBefore,
    }
  }

  debug(
    `Skipping insertion in ${path}: no existing line to anchor a suggestion to (empty file)`
  )
  return null
}

/**
 * Build review comment drafts for all edit runs in a hunk.
 *
 * Handles one anchor collision: an insertion at the top of the file anchors
 * line 1 via its following context line, and an insertion right after line 1
 * anchors that same line. Such neighboring runs are merged into a single
 * suggestion (added lines, then line 1's content, then the other run's added
 * lines) so the review does not contain two suggestions for one line.
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
    if (
      isPureInsertion(run) &&
      !run.precedingContext &&
      run.followingContext &&
      nextRun &&
      isPureInsertion(nextRun) &&
      nextRun.precedingContext === run.followingContext
    ) {
      drafts.push({
        path,
        body: createSuggestion(
          [
            ...run.addedLines.map((line) => line.content),
            run.followingContext.content,
            ...nextRun.addedLines.map((line) => line.content),
          ].join('\n')
        ),
        line: run.followingContext.lineBefore,
      })
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
 * Sort comments so batched suggestion application processes lower lines before higher lines.
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

/**
 * Fetch the canonical PR diff as a string or return null on failure/unavailability.
 */
async function fetchCanonicalDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  if (
    !octokit.pulls ||
    typeof (octokit as { pulls?: { get?: unknown } }).pulls?.get !== 'function'
  ) {
    debug('PR diff filter: pulls.get unavailable; skipping.')
    return null
  }
  try {
    // When using application/vnd.github.v3.diff, the response data is a string, not the normal PR object
    const { data } = (await octokit.pulls.get({
      owner,
      repo,
      pull_number,
      headers: { accept: 'application/vnd.github.v3.diff' },
    })) as unknown as { data: string }
    if (typeof data !== 'string' || !/^diff --git /.test(data)) {
      debug('PR diff filter: no usable diff string; skipping.')
      return null
    }
    return data
  } catch (err) {
    if (isRateLimitError(err)) throw err
    debug(`PR diff fetch failed: ${formatError(err)}`)
    return null
  }
}

/**
 * Build a lookup of valid right-side line numbers per file path.
 */
function buildRightSideAnchors(
  parsedDiff: ReturnType<typeof parseGitDiff>
): Record<string, Set<number>> {
  return Object.fromEntries(
    parsedDiff.files
      .filter(
        (file) => file.type === 'ChangedFile' || file.type === 'AddedFile'
      )
      .map((file) => [
        file.path,
        new Set(
          file.chunks
            .filter((chunk) => chunk.type === 'Chunk')
            .flatMap((chunk) =>
              chunk.changes
                .filter(
                  (change) => isAddedLine(change) || isUnchangedLine(change)
                )
                .map((change) => change.lineAfter)
            )
        ),
      ])
  )
}

/**
 * Determine if a review comment draft is valid within the PR diff.
 */
function isValidSuggestion(
  comment: ReviewCommentDraft,
  anchors: Record<string, Set<number>>
): boolean {
  const validLines = anchors[comment.path]
  if (!validLines) return false
  if (!validLines.has(comment.line)) return false
  if (comment.start_line !== undefined && !validLines.has(comment.start_line))
    return false
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
 * Filter the supplied draft comments to those whose lines are part of the canonical
 * pull request diff (per GitHub's API).
 *
 * Returns a new array containing only valid suggestions and logs summary info.
 * Falls back to the original comments when the diff cannot be fetched/parsed for
 * benign reasons (e.g. unsupported endpoint, malformed response, parse error).
 * Rate-limit errors propagate so the caller can stop processing instead of
 * posting suggestions that may be outside the diff.
 */
async function filterSuggestionsInPullRequestDiff({
  octokit,
  owner,
  repo,
  pull_number,
  comments,
}: {
  octokit: Octokit
  owner: string
  repo: string
  pull_number: number
  comments: ReviewCommentDraft[]
}): Promise<ReviewCommentDraft[]> {
  const diffString = await fetchCanonicalDiff(octokit, owner, repo, pull_number)
  if (!diffString) return comments

  let parsedPullRequestDiff
  try {
    parsedPullRequestDiff = parseGitDiff(diffString)
  } catch (err) {
    warning(`PR diff parse failed: ${formatError(err)}`)
    return comments
  }

  const rightSideAnchors = buildRightSideAnchors(parsedPullRequestDiff)
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
  const comments = await filterSuggestionsInPullRequestDiff({
    octokit,
    owner,
    repo,
    pull_number,
    comments: initialComments,
  })
  if (!comments.length) {
    return { comments: [], reviewCreated: false }
  }

  const reviewComments = comments.slice(0, MAX_COMMENTS_PER_REVIEW)
  // Submit lower lines first so batched application does not shift later anchors.
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

  const pullRequestFiles = (
    await octokit.paginate(octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })
  ).map((file: PullRequestFile) => file.filename)

  // Get the diff between the head branch and the base branch (limit to the files in the pull request)
  const diff = await getGitDiff(['--', ...pullRequestFiles])

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

  await run({ octokit, owner, repo, pull_number, commit_id, diff, event, body })
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
