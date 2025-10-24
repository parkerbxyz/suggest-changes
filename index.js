// @ts-check

import { debug, getInput, info, setFailed, warning } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'
import { RequestError } from '@octokit/request-error'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

/** @typedef {import('parse-git-diff').AnyLineChange} AnyLineChange */
/** @typedef {import('parse-git-diff').AddedLine} AddedLine */
/** @typedef {import('parse-git-diff').DeletedLine} DeletedLine */
/** @typedef {import('parse-git-diff').UnchangedLine} UnchangedLine */
/** @typedef {import('@octokit/types').Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}/comments']['response']['data'][number]} GetReviewComment */
/** @typedef {NonNullable<import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['comments']>[number]} ReviewCommentInput */
/** @typedef {ReviewCommentInput & { line: number }} ReviewCommentDraft */
/** @typedef {NonNullable<import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['event']>} ReviewEvent */
/** @typedef {import("@octokit/webhooks-types").PullRequestEvent} PullRequestEvent */

/**
 * @typedef {Object} SuggestionBody
 * @property {string} body
 * @property {number} lineCount
 */

/**
 * Type guard to check if a change is an AddedLine
 * @param {AnyLineChange} change - The change to check
 * @returns {change is AddedLine} True if the change is an AddedLine
 */
function isAddedLine(change) {
  return change?.type === 'AddedLine' && typeof change.lineAfter === 'number'
}

/**
 * Type guard to check if a change is a DeletedLine
 * @param {AnyLineChange} change - The change to check
 * @returns {change is DeletedLine} True if the change is a DeletedLine
 */
function isDeletedLine(change) {
  return change?.type === 'DeletedLine' && typeof change.lineBefore === 'number'
}

/**
 * Type guard to check if a change is an UnchangedLine
 * @param {AnyLineChange} change - The change to check
 * @returns {change is UnchangedLine} True if the change is an UnchangedLine
 */
function isUnchangedLine(change) {
  return (
    change?.type === 'UnchangedLine' &&
    typeof change.lineBefore === 'number' &&
    typeof change.lineAfter === 'number'
  )
}

/**
 * Generate git diff output with consistent flags
 * @param {string[]} gitArgs - Additional git diff arguments
 * @returns {Promise<string>} The git diff output
 */
export async function getGitDiff(gitArgs) {
  const result = await getExecOutput(
    'git',
    ['diff', '--unified=1', '--ignore-cr-at-eol', ...gitArgs],
    { silent: true, ignoreReturnCode: true }
  )
  return result.stdout
}

/**
 * Create a suggestion fenced block.
 * @param {string} content
 * @returns {string}
 */
export const createSuggestion = (content) => {
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${content}\n\`\`\`\``
}

/**
 * Format a line range for logging: "start-end" for multi-line, or the single line number.
 * startLine is undefined for single-line suggestions; line is always defined.
 * @param {number | undefined} startLine
 * @param {number} line
 * @returns {string}
 */
function formatLineRange(startLine, line) {
  return typeof startLine === 'number' && startLine !== line
    ? `${startLine}-${line}`
    : String(line)
}

/**
 * Returns true for the known 422 "line must be part of the diff" validation failure.
 * Strictly requires an Octokit RequestError so unrelated errors are rethrown.
 * @param {unknown} err
 * @returns {err is RequestError}
 */
function isLineOutsideDiffError(err) {
  return (
    err instanceof RequestError &&
    err.status === 422 &&
    /line must be part of the diff/i.test(String(err.message))
  )
}

/**
 * Normalize unknown error-like values to a concise string message.
 * @param {unknown} err
 * @returns {string}
 */
function formatError(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Filter changes by type for easier processing
 * @param {AnyLineChange[]} changes - Array of changes to filter
 * @returns {{addedLines: AddedLine[], deletedLines: DeletedLine[], unchangedLines: UnchangedLine[]}}
 */
const filterChangesByType = (changes) => ({
  addedLines: changes.filter(isAddedLine),
  deletedLines: changes.filter(isDeletedLine),
  unchangedLines: changes.filter(isUnchangedLine),
})

/**
 * Check if group matches pattern: first is unchanged, rest are all added lines.
 * This pattern indicates blank line insertions after content lines.
 * @param {AnyLineChange[]} group - Group of changes to check
 * @returns {boolean} True if pattern matches
 */
function isUnchangedFollowedByAdded(group) {
  return (
    group.length > 0 &&
    isUnchangedLine(group[0]) &&
    group.slice(1).every(isAddedLine)
  )
}

/**
 * Detect if the group contains a line movement pattern where content is deleted
 * and re-added at a different location (typically to insert blank lines).
 * Pattern: [..., Deleted line, Unchanged line(s), upcoming Added line with same content]
 * @param {AnyLineChange[]} currentGroup - Current group being built
 * @param {AnyLineChange} nextChange - Next change to potentially add
 * @param {AnyLineChange[]} remainingChanges - All changes after nextChange
 * @returns {boolean} True if this appears to be a line movement
 */
function isLineMovement(currentGroup, nextChange, remainingChanges) {
  // Check if nextChange is an added line
  if (!isAddedLine(nextChange)) return false

  // Look for a deleted line in the current group
  const deletedLine = currentGroup.find(isDeletedLine)
  if (!deletedLine) return false

  // Check if the deleted and added lines have the same content
  // This indicates the line is being moved, not changed
  return deletedLine.content === nextChange.content
}

/**
 * Check if current group should be closed for blank line insertion pattern.
 * Pattern: [Unchanged, Added...] followed by another Unchanged.
 * This helps create clean [Unchanged, Added] pairs for blank line insertions.
 * @param {AnyLineChange[]} currentGroup - Current group being built
 * @param {AnyLineChange} nextChange - Next change to potentially add
 * @returns {boolean} True if group should be closed
 */
function shouldSplitForBlankLineInsertion(currentGroup, nextChange) {
  return isUnchangedFollowedByAdded(currentGroup) && isUnchangedLine(nextChange)
}

/**
 * Find the line number of the last added or deleted line (excluding unchanged lines).
 * Used to detect gaps between changes for proper grouping.
 * @param {AnyLineChange[]} group - Group to search
 * @returns {number | null} Line number of last added or deleted line, or null if no such changes found
 */
function getLastChangedLineNumber(group) {
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
 *
 * @param {AnyLineChange[]} changes - Array of line changes from git diff
 * @returns {AnyLineChange[][]} Array of suggestion groups
 */
export const groupChangesForSuggestions = (changes) => {
  if (changes.length === 0) return []

  /** @type {AnyLineChange[][]} */
  const groups = []
  /** @type {AnyLineChange[]} */
  let currentGroup = []

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const remainingChanges = changes.slice(i + 1)

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
    const appearsToBeLineMovement = isLineMovement(
      currentGroup,
      change,
      remainingChanges
    )

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
 * @param {UnchangedLine[]} unchangedLines - Array of unchanged lines
 * @param {AddedLine[]} addedLines - Array of added lines
 * @returns {boolean} True if context line comes before added lines
 */
const getContextLineComesFirst = (unchangedLines, addedLines) => {
  return (
    unchangedLines.length > 0 &&
    addedLines.length > 0 &&
    unchangedLines[0].lineAfter < addedLines[0].lineAfter
  )
}

/**
 * Generate suggestion body and line count for a group of changes
 * @param {AnyLineChange[]} changes - Group of related changes
 * @returns {SuggestionBody | null} Suggestion body and line count, or null if no suggestion needed
 */
export const generateSuggestionBody = (changes) => {
  const { addedLines, deletedLines, unchangedLines } =
    filterChangesByType(changes)

  // Detect line movement: deletion and addition of same content.
  // This happens when linters move lines to insert blank lines before them.
  // Instead of creating complex multi-line suggestions (which cause GitHub API issues),
  // we create a simple single-line suggestion to add the blank line.
  if (deletedLines.length === 1 && addedLines.length === 1) {
    const deleted = deletedLines[0]
    const added = addedLines[0]

    // If the deleted and added content is the same, this is a line movement
    if (deleted.content === added.content) {
      // Find the unchanged line before the deletion
      const unchangedBeforeDeletion = unchangedLines.find(
        (u) => u.lineBefore < deleted.lineBefore
      )

      if (unchangedBeforeDeletion) {
        // Create a simple single-line suggestion to add a blank after the context line.
        // Trade-off: This may result in an extra blank line if there are consecutive blanks,
        // but it avoids GitHub API issues with multi-line suggestions and ensures safe batching.
        return {
          body: createSuggestion(unchangedBeforeDeletion.content + '\n'),
          lineCount: 1,
        }
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

    const suggestionLines = contextLineComesFirst
      ? [unchangedLines[0].content, ...addedLines.map((line) => line.content)]
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
 * @param {AnyLineChange[]} groupChanges - The changes in this group
 * @param {number} lineCount - Number of lines the suggestion spans
 * @param {{start: number}} fromFileRange - File range information
 * @returns {{startLine: number, endLine: number}} Line positioning
 */
export const calculateLinePosition = (
  groupChanges,
  lineCount,
  fromFileRange
) => {
  const { addedLines, deletedLines, unchangedLines } =
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
  if (
    deletedLines.length === 1 &&
    addedLines.length === 1 &&
    deletedLines[0].content === addedLines[0].content &&
    firstUnchangedLine &&
    firstUnchangedLine.lineBefore < deletedLines[0].lineBefore
  ) {
    // Line movement: anchor to the unchanged line before the deletion
    const startLine = firstUnchangedLine.lineBefore
    return { startLine, endLine: startLine + lineCount - 1 }
  }

  // Determine anchor line based on the type of change
  const startLine =
    firstDeletedLine?.lineBefore ?? // Deletions: use original line
    (firstUnchangedLine && addedLines.length > 0
      ? // Pure additions with context: check if context comes before or after additions
        getContextLineComesFirst(unchangedLines, addedLines)
        ? firstUnchangedLine.lineBefore // Context line comes first: anchor to it
        : Math.max(1, firstUnchangedLine.lineBefore - 1) // Context line comes after: anchor to line before it
      : firstUnchangedLine?.lineBefore ?? fromFileRange.start) // Fallback to context line or file range

  return { startLine, endLine: startLine + lineCount - 1 }
}

/**
 * Function to generate a unique key for a comment
 * @param {ReviewCommentInput | GetReviewComment} comment
 * @returns {string}
 */
export const generateCommentKey = (comment) =>
  `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${
    comment.body
  }`

/**
 * Lazily iterate over all suggestion groups in a parsed diff.
 * Yields objects containing path, fromFileRange, and group changes.
 * @param {ReturnType<typeof parseGitDiff>} parsedDiff
 */
function* iterateSuggestionGroups(parsedDiff) {
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
 * @param {string} path
 * @param {{start: number}} fromFileRange
 * @param {AnyLineChange[]} group
 * @returns {ReviewCommentDraft | null}
 */
function buildCommentDraft(path, fromFileRange, group) {
  const suggestion = generateSuggestionBody(group)
  if (!suggestion) return null
  const { body, lineCount } = suggestion
  const { startLine, endLine } = calculateLinePosition(
    group,
    lineCount,
    fromFileRange
  )
  return /** @type {ReviewCommentDraft} */ ({
    path,
    body,
    line: endLine,
    ...(lineCount > 1 && {
      start_line: startLine,
    }),
  })
}

/**
 * Partition an iterable into two arrays based on a predicate.
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => boolean} predicate
 * @returns {{pass: T[], fail: T[]}}
 */
function partition(items, predicate) {
  /** @type {T[]} */ const pass = []
  /** @type {T[]} */ const fail = []
  for (const item of items) {
    ;(predicate(item) ? pass : fail).push(item)
  }
  return { pass, fail }
}

/**
 * Generate GitHub review comments from a parsed diff (exported for testing)
 * @param {ReturnType<typeof parseGitDiff>} parsedDiff - Parsed diff from parse-git-diff
 * @param {Set<string>} existingCommentKeys - Set of existing comment keys to avoid duplicates
 * @returns {Array<ReviewCommentDraft>} Generated comments
 */
export function generateReviewComments(
  parsedDiff,
  existingCommentKeys = new Set()
) {
  const drafts = []
  for (const { path, fromFileRange, group } of iterateSuggestionGroups(
    parsedDiff
  )) {
    const draft = buildCommentDraft(path, fromFileRange, group)
    if (draft) drafts.push(draft)
  }
  const { pass: unique, fail: skipped } = partition(
    drafts,
    (draft) => !existingCommentKeys.has(generateCommentKey(draft))
  )
  if (skipped.length) {
    logCommentList(
      'Suggestions skipped because they would duplicate existing suggestions:',
      skipped
    )
  }
  return unique
}

/**
 * Fetch the canonical PR diff as a string or return null on failure/unavailability.
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} pull_number
 * @returns {Promise<string | null>}
 */
async function fetchCanonicalDiff(octokit, owner, repo, pull_number) {
  if (
    !octokit.pulls ||
    typeof (/** @type {any} */ octokit.pulls.get) !== 'function'
  ) {
    debug('PR diff filter: pulls.get unavailable; skipping.')
    return null
  }
  try {
    const { data } = await /** @type {any} */ (octokit).pulls.get({
      owner,
      repo,
      pull_number,
      headers: { accept: 'application/vnd.github.v3.diff' },
    })
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
 * @param {ReturnType<typeof parseGitDiff>} parsedDiff
 * @returns {Record<string, Set<number>>}
 */
function buildRightSideAnchors(parsedDiff) {
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
 * @param {ReviewCommentDraft} comment
 * @param {Record<string, Set<number>>} anchors
 */
function isValidSuggestion(comment, anchors) {
  const validLines = anchors[comment.path]
  if (!validLines) return false
  if (!validLines.has(comment.line)) return false
  if (comment.start_line !== undefined && !validLines.has(comment.start_line))
    return false
  return true
}

/**
 * Log a list of review comment drafts with a standardized header.
 * @param {string} header
 * @param {ReviewCommentDraft[]} comments
 * @param {(message: string) => void} [logger]
 */
function logCommentList(header, comments, logger = info) {
  if (!comments.length) return
  logger(`${header} ${comments.length}`)
  for (const comment of comments) {
    logger(
      `- ${comment.path}:${formatLineRange(comment.start_line, comment.line)}`
    )
  }
}

/**
 * Filters suggestion comments using the canonical server-side PR diff.
 * Returns a new array containing only valid suggestions and logs summary info.
 * Gracefully falls back (returns original comments) if the diff cannot be fetched/parsed.
 * @param {Object} params
 * @param {Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.pull_number
 * @param {Array<ReviewCommentDraft>} params.comments
 * @returns {Promise<Array<ReviewCommentDraft>>}
 */
async function filterSuggestionsInPullRequestDiff({
  octokit,
  owner,
  repo,
  pull_number,
  comments,
}) {
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
  logCommentList(
    'Suggestions skipped because they are outside the pull request diff:',
    skipped
  )
  return valid
}

/**
 * Main execution function for the GitHub Action
 * @param {Object} options - Configuration options
 * @param {Octokit} options.octokit - Octokit instance
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.pull_number - Pull request number
 * @param {string} options.commit_id - Commit SHA
 * @param {string} options.diff - Git diff output
 * @param {ReviewEvent} options.event - Review event type
 * @param {string} options.body - Review body
 * @returns {Promise<{comments: ReviewCommentDraft[], reviewCreated: boolean}>} Result of the action
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
}) {
  debug(`Diff output: ${diff}`)

  const existingComments = (
    await octokit.pulls.listReviewComments({ owner, repo, pull_number })
  ).data
  const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

  // Parse diff after collecting existing comment keys
  const parsedDiff = parseGitDiff(diff)

  const initialComments = generateReviewComments(
    parsedDiff,
    existingCommentKeys
  )
  if (initialComments.length) {
    debug(`Generated suggestions: ${initialComments.length}`)
    for (const comment of initialComments) {
      debug(`- Draft review comment:`)
      debug(`  path: ${comment.path}`)
      debug(`  line: ${comment.line}`)
      if (comment.start_line !== undefined) {
        debug(`  start_line: ${comment.start_line}`)
      }
      if (comment.start_side !== undefined) {
        debug(`  start_side: ${comment.start_side}`)
      }
      debug(`  body:`)
      const indentedBody = comment.body
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')
      debug(indentedBody)
    }
  } else {
    debug('Generated suggestions: 0')
  }
  const comments = await filterSuggestionsInPullRequestDiff({
    octokit,
    owner,
    repo,
    pull_number,
    comments: initialComments,
  })
  logCommentList(`Suggestions to be included in review:`, comments)
  if (!comments.length) {
    return { comments: [], reviewCreated: false }
  }
  try {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number,
      commit_id,
      body,
      event,
      comments,
    })
    debug('Batch create succeeded.')
    return { comments, reviewCreated: true }
  } catch (err) {
    if (isLineOutsideDiffError(err)) {
      debug(
        'Batch review creation failed (422: line must be part of the diff). Returning without review.'
      )
      return { comments: [], reviewCreated: false }
    }
    throw err
  }
}

// Main entrypoint (only when executed directly)
async function main() {
  const octokit = new Octokit({
    userAgent: 'suggest-changes',
  })

  const [owner, repo] = String(env.GITHUB_REPOSITORY).split('/')

  /** @type {PullRequestEvent} */
  const eventPayload = JSON.parse(
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
  ).data.map((file) => file.filename)

  // Get the diff between the head branch and the base branch (limit to the files in the pull request)
  const diff = await getGitDiff(['--', ...pullRequestFiles])

  const event = /** @type {ReviewEvent} */ (getInput('event').toUpperCase())
  const body = getInput('comment')

  await run({ octokit, owner, repo, pull_number, commit_id, diff, event, body })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) =>
    setFailed(err instanceof Error ? err.message : String(err))
  )
}
