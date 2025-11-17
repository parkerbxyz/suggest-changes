import { debug, getInput, info, setFailed, warning } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

import type {
  AddedLine,
  AnyLineChange,
  DeletedLine,
  FilteredChanges,
  GetReviewComment,
  LineMovement,
  LinePosition,
  LogOptions,
  PartitionResult,
  PullRequestEvent,
  PullRequestFile,
  ReviewCommentDraft,
  ReviewCommentInput,
  ReviewEvent,
  RunConfig,
  RunResult,
  SuggestionBody,
  UnchangedLine,
} from './types'

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
 * Filter changes by type for easier processing
 */
const filterChangesByType = (changes: AnyLineChange[]): FilteredChanges => ({
  addedLines: changes.filter(isAddedLine),
  deletedLines: changes.filter(isDeletedLine),
  unchangedLines: changes.filter(isUnchangedLine),
})

/**
 * Check if group matches pattern: first is unchanged, rest are all added lines.
 * This pattern indicates blank line insertions after content lines.
 */
function isUnchangedFollowedByAdded(group: AnyLineChange[]): boolean {
  const first = group[0]
  return (
    group.length > 0 &&
    first !== undefined &&
    isUnchangedLine(first) &&
    group.slice(1).every(isAddedLine)
  )
}

/**
 * Check if two changes represent a line movement (same content, different positions).
 */
function isContentMovement(deleted: DeletedLine, added: AddedLine): boolean {
  return deleted.content === added.content
}

/**
 * Detect if changes contain a line movement pattern (deletion + addition of same content).
 * Returns the deleted and added lines if a movement is detected, null otherwise.
 */
function detectLineMovement(
  changes: AnyLineChange[]
): LineMovement | null {
  const { deletedLines, addedLines } = filterChangesByType(changes)

  if (deletedLines.length === 1 && addedLines.length === 1) {
    const deleted = deletedLines[0]
    const added = addedLines[0]
    if (deleted && added && isContentMovement(deleted, added)) {
      return { deleted, added }
    }
  }

  return null
}

/**
 * Detect if the group contains a line movement pattern where content is deleted
 * and re-added at a different location (typically to insert blank lines).
 * Pattern: [..., Deleted line, Unchanged line(s), upcoming Added line with same content]
 */
function isLineMovement(
  currentGroup: AnyLineChange[],
  nextChange: AnyLineChange
): boolean {
  // Check if nextChange is an added line
  if (!isAddedLine(nextChange)) return false

  // Look for a deleted line in the current group
  const deletedLine = currentGroup.find(isDeletedLine)
  if (!deletedLine) return false

  // Check if the deleted and added lines have the same content
  // This indicates the line is being moved, not changed
  return isContentMovement(deletedLine, nextChange)
}

/**
 * Check if current group should be closed for blank line insertion pattern.
 * Pattern: [Unchanged, Added...] followed by another Unchanged.
 * This helps create clean [Unchanged, Added] pairs for blank line insertions.
 */
function shouldSplitForBlankLineInsertion(
  currentGroup: AnyLineChange[],
  nextChange: AnyLineChange
): boolean {
  return isUnchangedFollowedByAdded(currentGroup) && isUnchangedLine(nextChange)
}

/**
 * Find the line number of the last added or deleted line (excluding unchanged lines).
 * Used to detect gaps between changes for proper grouping.
 */
function getLastChangedLineNumber(group: AnyLineChange[]): number | null {
  const lastChange = group.findLast((c) => isDeletedLine(c) || isAddedLine(c))
  if (!lastChange) return null
  return isDeletedLine(lastChange)
    ? lastChange.lineBefore
    : lastChange.lineAfter
}

/**
 * Group changes into logical suggestion groups based on line proximity.
 *
 * Groups contiguous or nearly contiguous changes together to create logical
 * suggestions that make sense when reviewing code. Unchanged lines are included
 * for context but don't affect contiguity calculations.
 *
 * Special case for blank line insertions (https://github.com/parkerbxyz/suggest-changes/issues/118):
 * When linters add blank lines, we get patterns like [Unchanged, Add(""), Unchanged, Add(""), ...].
 * We split these into separate [Unchanged, Add("")] pairs to create intuitive suggestions
 * that show adding a blank line after each content line, rather than confusing multi-line groups.
 *
 * Special case for line movements:
 * When a line is deleted and re-added at a different location (e.g., to insert blank lines before it),
 * we keep the deletion and addition in the same group to avoid creating separate delete/add suggestions.
 */
export function groupChangesForSuggestions(
  changes: AnyLineChange[]
): AnyLineChange[][] {
  if (changes.length === 0) return []

  const groups: AnyLineChange[][] = []
  let currentGroup: AnyLineChange[] = []

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (!change) continue

    // Check if we should split the group for blank line insertion pattern
    if (shouldSplitForBlankLineInsertion(currentGroup, change)) {
      groups.push(currentGroup)
      currentGroup = [change]
      continue
    }

    // Determine line number for gap detection
    const lineNumber = isDeletedLine(change)
      ? change.lineBefore
      : isAddedLine(change)
      ? change.lineAfter
      : isUnchangedLine(change)
      ? change.lineBefore
      : null

    if (lineNumber === null) continue

    // Get the last changed line number (ignoring unchanged lines)
    const lastChangedLineNumber = getLastChangedLineNumber(currentGroup)

    // Check if this looks like a line movement before applying gap detection
    const appearsToBeLineMovement = isLineMovement(currentGroup, change)

    // Start new group if there's a line gap between actual changes (not unchanged lines)
    // BUT: Don't split if this appears to be a line movement (delete + re-add same content)
    if (
      !isUnchangedLine(change) &&
      lastChangedLineNumber !== null &&
      lineNumber > lastChangedLineNumber + 1 &&
      !appearsToBeLineMovement
    ) {
      groups.push(currentGroup)
      currentGroup = []
    }

    currentGroup.push(change)
  }

  if (currentGroup.length > 0) groups.push(currentGroup)

  return groups
}

/**
 * Helper function to determine if context line comes before added lines.
 */
const getContextLineComesFirst = (
  unchangedLines: UnchangedLine[],
  addedLines: AddedLine[]
): boolean => {
  const firstUnchanged = unchangedLines[0]
  const firstAdded = addedLines[0]
  if (!firstUnchanged || !firstAdded) return false
  return firstUnchanged.lineAfter < firstAdded.lineAfter
}

/**
 * Determine the anchor line for pure additions with context.
 */
function getAnchorForAdditions(
  firstUnchangedLine: UnchangedLine,
  unchangedLines: UnchangedLine[],
  addedLines: AddedLine[]
): number {
  if (getContextLineComesFirst(unchangedLines, addedLines)) {
    return firstUnchangedLine.lineBefore // Context comes first: anchor to it
  }
  return Math.max(1, firstUnchangedLine.lineBefore - 1) // Context comes after: anchor to line before it
}

/**
 * Generate suggestion body and line count for a group of changes
 */
export function generateSuggestionBody(
  changes: AnyLineChange[]
): SuggestionBody | null {
  const { addedLines, deletedLines, unchangedLines } =
    filterChangesByType(changes)

  // Detect line movement: deletion and addition of same content.
  // This happens when linters move lines to insert blank lines before them.
  // Example: Line "foo" at position 5 is deleted and re-added at position 3.
  // Without this special handling, we'd suggest "replace 'foo' with 'foo'" (confusing no-op).
  // Instead, we suggest inserting a blank line before the moved content.
  const movement = detectLineMovement(changes)
  if (movement) {
    const { deleted } = movement

    // Find the unchanged line before the deletion (context line)
    const unchangedBeforeDeletion = unchangedLines.find(
      (u) => u.lineBefore < deleted.lineBefore
    )

    if (unchangedBeforeDeletion) {
      // Count unchanged blank lines after the deleted line in the original file.
      // When the line moves up, these blanks end up after it in the new position.
      // To avoid consecutive blanks, we keep N-1 of them (removing one redundant blank).
      const blanksAfterDeletion = unchangedLines.filter(
        (u) => u.lineBefore > deleted.lineBefore && u.content === ''
      )

      // Build suggestion to show what the final state should be:
      // 1. Context line (unchanged before deletion)
      // 2. New blank line (being inserted)
      // 3. Moved content line
      // 4. Keep N-1 of the existing trailing blanks to maintain the same total number of blanks
      //    (we're adding 1 new blank, so we keep N-1 existing ones to avoid increasing the total)
      const suggestionLines = [
        unchangedBeforeDeletion.content,
        '',
        deleted.content,
      ]

      // Keep only N-1 existing blanks by skipping the first (index 0) using slice(1)
      // This maintains the same total blank line count after inserting the new blank
      blanksAfterDeletion.slice(1).forEach(() => suggestionLines.push(''))

      // Calculate total lines being replaced in the suggestion:
      // - 1 unchanged context line
      // - 1 deleted/moved line
      // - N trailing blank lines after deletion
      const totalReplacedLines = 1 + 1 + blanksAfterDeletion.length

      return {
        body: createSuggestion(suggestionLines.join('\n')),
        lineCount: totalReplacedLines,
      }
    }
  }

  // No additions means no content to suggest, except for pure deletions (empty replacement block)
  if (addedLines.length === 0) {
    if (deletedLines.length === 0) return null
    return { body: createSuggestion(''), lineCount: deletedLines.length }
  }

  // Pure additions: include context if available
  if (deletedLines.length === 0) {
    const contextLineComesFirst = getContextLineComesFirst(
      unchangedLines,
      addedLines
    )

    const firstUnchanged = unchangedLines[0]
    const suggestionLines = contextLineComesFirst && firstUnchanged
      ? [firstUnchanged.content, ...addedLines.map((line) => line.content)]
      : addedLines.map((line) => line.content)

    // lineCount represents the number of existing (anchor) lines being replaced,
    // not the number of lines in the suggestion body (which can include context plus additions).
    return {
      body: createSuggestion(suggestionLines.join('\n')),
      lineCount: contextLineComesFirst ? 1 : addedLines.length,
    }
  }

  // Mixed changes: replace deleted content with added content
  const suggestionLines = addedLines.map((line) => line.content)
  return {
    body: createSuggestion(suggestionLines.join('\n')),
    lineCount: deletedLines.length,
  }
}

/**
 * Calculate line positioning for GitHub review comments.
 */
export function calculateLinePosition(
  groupChanges: AnyLineChange[],
  lineCount: number,
  fromFileRange: { start: number }
): LinePosition {
  const { addedLines, unchangedLines } =
    filterChangesByType(groupChanges)

  // Try to find the best target line in order of preference
  const firstDeletedLine = groupChanges.find(isDeletedLine)
  const firstUnchangedLine =
    unchangedLines.length > 0 ? unchangedLines[0] : undefined

  // Log unexpected state: unchanged line present but no added lines
  if (firstUnchangedLine && addedLines.length === 0 && !firstDeletedLine) {
    debug(
      `[BUG] Unexpected state: firstUnchangedLine present but addedLines.length === 0. ` +
        `This branch should not be reached. groupChanges: ${JSON.stringify(
          groupChanges
        )}`
    )
  }

  // Check for line movement: if we have deletion and addition of same content,
  // anchor to the unchanged line before the deletion
  const movement = detectLineMovement(groupChanges)
  if (
    movement &&
    firstUnchangedLine &&
    firstUnchangedLine.lineBefore < movement.deleted.lineBefore
  ) {
    // Line movement: anchor to the unchanged line before the deletion
    const startLine = firstUnchangedLine.lineBefore
    return { startLine, endLine: startLine + lineCount - 1 }
  }

  // Determine anchor line based on the type of change
  const startLine =
    firstDeletedLine?.lineBefore ?? // Deletions: use original line
    (firstUnchangedLine && addedLines.length > 0
      ? getAnchorForAdditions(firstUnchangedLine, unchangedLines, addedLines) // Pure additions with context
      : firstUnchangedLine?.lineBefore ?? fromFileRange.start) // Fallback to context line or file range

  return { startLine, endLine: startLine + lineCount - 1 }
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
 * Lazily iterate over all suggestion groups in a parsed diff.
 * Yields objects containing path, fromFileRange, and group changes.
 */
function* iterateSuggestionGroups(parsedDiff: ReturnType<typeof parseGitDiff>) {
  for (const file of parsedDiff.files) {
    if (file.type !== 'ChangedFile') continue
    const path = file.path
    for (const chunk of file.chunks) {
      if (chunk.type !== 'Chunk') continue
      const { fromFileRange, changes } = chunk
      const groups = groupChangesForSuggestions(changes)
      for (const group of groups) {
        yield { path, fromFileRange, group }
      }
    }
  }
}

/**
 * Build a review comment draft from a suggestion group.
 * Returns null if the group does not produce a valid suggestion body.
 */
function buildCommentDraft(
  path: string,
  fromFileRange: { start: number },
  group: AnyLineChange[]
): ReviewCommentDraft | null {
  const suggestion = generateSuggestionBody(group)
  if (!suggestion) return null
  const { body, lineCount } = suggestion
  const { startLine, endLine } = calculateLinePosition(
    group,
    lineCount,
    fromFileRange
  )
  return {
    path,
    body,
    line: endLine,
    ...(lineCount > 1 && {
      start_line: startLine,
      start_side: 'RIGHT' as const,
    }),
  }
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
  for (const { path, fromFileRange, group } of iterateSuggestionGroups(
    parsedDiff
  )) {
    const draft = buildCommentDraft(path, fromFileRange, group)
    if (draft) drafts.push(draft)
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

  const { pass: unique, fail: skipped } = partition(
    drafts,
    (draft) => !existingCommentKeys.has(generateCommentKey(draft))
  )
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
 * Filters suggestion comments using the canonical server-side PR diff.
 * Returns a new array containing only valid suggestions and logs summary info.
 * Gracefully falls back (returns original comments) if the diff cannot be fetched/parsed.
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

  const existingComments = (
    await octokit.pulls.listReviewComments({ owner, repo, pull_number })
  ).data
  const existingCommentKeys = new Set<string>(existingComments.map(generateCommentKey))

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
  logComments('Suggestions to be included in review:', comments)
  if (!comments.length) {
    return { comments: [], reviewCreated: false }
  }
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    commit_id,
    body,
    event,
    comments,
  })
  info(`Review created successfully with ${comments.length} suggestion(s).`)
  return { comments, reviewCreated: true }
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
    await octokit.pulls.listFiles({ owner, repo, pull_number })
  ).data.map((file: PullRequestFile) => file.filename)

  // Get the diff between the head branch and the base branch (limit to the files in the pull request)
  const diff = await getGitDiff(['--', ...pullRequestFiles])

  // Validate and parse the event input
  const eventInput = (getInput('event') || 'COMMENT').toUpperCase()
  const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const
  if (!validEvents.includes(eventInput as any)) {
    throw new Error(
      `Invalid event type: "${eventInput}". Must be one of: ${validEvents.join(', ')}`
    )
  }
  const event = eventInput as ReviewEvent
  const body = getInput('comment') || ''

  await run({ octokit, owner, repo, pull_number, commit_id, diff, event, body })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) =>
    setFailed(err instanceof Error ? err.message : String(err))
  )
}
