// @ts-check

import { debug, getInput, info, setFailed } from '@actions/core'
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
/** @typedef {import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/comments']['response']['data']} CreatedReviewComment */
/** @typedef {import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['response']['data']} CreatedReview */
/** @typedef {import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/comments']['parameters']} CreateReviewCommentParams */
/** @typedef {Pick<CreateReviewCommentParams,'path'|'body'|'start_line'> & { line: number }} ReviewCommentDraft */
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
 * Returns true for the 422 error when a user already has a pending review on the PR.
 * @param {unknown} err
 * @returns {err is RequestError}
 */
function isDuplicatePendingReviewError(err) {
  return (
    err instanceof RequestError &&
    err.status === 422 &&
    /only have one pending review/i.test(String(err.message))
  )
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
 * Group changes into logical suggestion groups based on line proximity.
 *
 * Groups contiguous or nearly contiguous changes together to create logical
 * suggestions that make sense when reviewing code. Unchanged lines are included
 * for context but don't affect contiguity calculations.
 *
 * @param {AnyLineChange[]} changes - Array of line changes from git diff
 * @returns {AnyLineChange[][]} Array of suggestion groups
 */
export const groupChangesForSuggestions = (changes) => {
  if (changes.length === 0) return []

  // Group by line proximity using appropriate coordinate systems
  // - Deletions use lineBefore (original file line numbers)
  // - Additions use lineAfter (new file line numbers)
  // - Unchanged use lineBefore (context positioning)
  const groups = []
  let currentGroup = []
  let lastChangedLineNumber = null

  for (const change of changes) {
    const lineNumber = isDeletedLine(change)
      ? change.lineBefore
      : isAddedLine(change)
      ? change.lineAfter
      : isUnchangedLine(change)
      ? change.lineBefore
      : null

    if (lineNumber === null) continue

    // Start new group if there's a line gap between actual changes (not unchanged lines)
    if (
      !isUnchangedLine(change) &&
      lastChangedLineNumber !== null &&
      lineNumber > lastChangedLineNumber + 1
    ) {
      groups.push(currentGroup)
      currentGroup = []
    }

    currentGroup.push(change)

    // Only track line numbers for actual changes (deletions and additions)
    if (!isUnchangedLine(change)) {
      lastChangedLineNumber = lineNumber
    }
  }

  if (currentGroup.length > 0) groups.push(currentGroup)

  return groups
}

/**
 * Generate suggestion body and line count for a group of changes
 * @param {AnyLineChange[]} changes - Group of related changes
 * @returns {SuggestionBody | null} Suggestion body and line count, or null if no suggestion needed
 */
export const generateSuggestionBody = (changes) => {
  const { addedLines, deletedLines, unchangedLines } =
    filterChangesByType(changes)

  // No additions means no content to suggest, except for pure deletions
  if (addedLines.length === 0) {
    return deletedLines.length > 0
      ? { body: createSuggestion(''), lineCount: deletedLines.length }
      : null
  }

  // Pure additions: include context if available
  if (deletedLines.length === 0) {
    const hasContext = unchangedLines.length > 0
    const suggestionLines = hasContext
      ? [unchangedLines[0].content, ...addedLines.map((line) => line.content)]
      : addedLines.map((line) => line.content)

    return {
      body: createSuggestion(suggestionLines.join('\n')),
      lineCount: hasContext ? 1 : addedLines.length,
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
  // Try to find the best target line in order of preference
  const firstDeletedLine = groupChanges.find(isDeletedLine)
  const firstUnchangedLine = groupChanges.find(isUnchangedLine)

  const startLine =
    firstDeletedLine?.lineBefore ?? // Deletions: use original line
    firstUnchangedLine?.lineBefore ?? // Pure additions with context: position on context line
    fromFileRange.start // Pure additions without context: use file range

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
 * Generate GitHub review comments from a parsed diff (exported for testing)
 * @param {ReturnType<typeof parseGitDiff>} parsedDiff - Parsed diff from parse-git-diff
 * @param {Set<string>} existingCommentKeys - Set of existing comment keys to avoid duplicates
 * @returns {Array<ReviewCommentDraft & { start_side?: string }>} Generated comments
 */
export function generateReviewComments(
  parsedDiff,
  existingCommentKeys = new Set()
) {
  return parsedDiff.files
    .filter((file) => file.type === 'ChangedFile')
    .flatMap(({ path, chunks }) =>
      chunks
        .filter((chunk) => chunk.type === 'Chunk')
        .flatMap(({ fromFileRange, changes }) =>
          processChunkChanges(path, fromFileRange, changes, existingCommentKeys)
        )
    )
}

/**
 * Process changes within a chunk to generate review comments
 * @param {string} path - File path
 * @param {{start: number}} fromFileRange - File range information
 * @param {AnyLineChange[]} changes - Changes in the chunk
 * @param {Set<string>} existingCommentKeys - Set of existing comment keys
 * @returns {Array<ReviewCommentDraft & { start_side?: string }>} Generated comments
 */
const processChunkChanges = (
  path,
  fromFileRange,
  changes,
  existingCommentKeys
) => {
  const suggestionGroups = groupChangesForSuggestions(changes)

  return suggestionGroups.flatMap((groupChanges) => {
    const suggestionBody = generateSuggestionBody(groupChanges)

    // Skip if no suggestion was generated
    if (!suggestionBody) return []

    const { body, lineCount } = suggestionBody
    const { startLine, endLine } = calculateLinePosition(
      groupChanges,
      lineCount,
      fromFileRange
    )

    // Create comment with conditional multi-line properties
    const comment = {
      path,
      body,
      line: endLine,
      ...(lineCount > 1 && { start_line: startLine, start_side: 'RIGHT' }),
    }

    // Skip if comment already exists
    const commentKey = generateCommentKey(comment)
    if (existingCommentKeys.has(commentKey)) {
      info(
        `Skipping suggestion for ${comment.path}:${formatLineRange(
          comment.start_line,
          comment.line
        )} to avoid duplicating existing review comment`
      )
      return []
    }
    return [comment]
  })
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
 * @returns {Promise<{comments: Array, reviewCreated: boolean}>} Result of the action
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

  const parsedDiff = parseGitDiff(diff)

  const existingComments = (
    await octokit.pulls.listReviewComments({ owner, repo, pull_number })
  ).data
  const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

  const comments = generateReviewComments(parsedDiff, existingCommentKeys)
  if (comments.length === 0) {
    return { comments: [], reviewCreated: false }
  }

  return await createReview({
    octokit,
    owner,
    repo,
    pull_number,
    commit_id,
    body,
    event,
    comments,
  })
}

/**
 * Unified review creation helper. Assumes comments array is non-empty.
 * Strategy:
 * 1. Attempt batch review creation with all comments.
 * 2. If it fails with the specific 422 "line must be part of the diff" error,
 *    create a pending review, add each comment individually (skipping only those
 *    that trigger the same 422), then submit if at least one was added.
 * 3. If every per-comment add fails, delete the pending review (best-effort) and
 *    report no review created.
 * @param {Object} params
 * @param {Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.pull_number
 * @param {string} params.commit_id
 * @param {string} params.body
 * @param {ReviewEvent} params.event
 * @param {Array} params.comments
 * @returns {Promise<{comments: Array, reviewCreated: boolean}>}
 */
async function createReview({
  octokit,
  owner,
  repo,
  pull_number,
  commit_id,
  body,
  event,
  comments,
}) {
  const prContext = { owner, repo, pull_number }

  /** Attempt to create a review with all comments. Throws on failure. */
  async function createReviewWithComments() {
    await octokit.pulls.createReview({
      ...prContext,
      commit_id,
      body,
      event,
      comments,
    })
  }

  /** Ensure a pending review exists (reuse existing or create new).
   * Returns { id, commitId, reused }.
   * If reusing and commit differs, we log a debug note and still proceed anchoring to the existing review commit. */
  async function ensurePendingReview() {
    try {
      /** @type {{ data: CreatedReview }} */
      const created = await octokit.pulls.createReview({
        ...prContext,
        commit_id,
        body,
      })
      return { id: created.data.id, commitId: commit_id, reused: false }
    } catch (err) {
      if (!isDuplicatePendingReviewError(err)) throw err
      const existing = await octokit.pulls.listReviews(prContext)
      const pending = existing.data.find((r) => r.state === 'PENDING')
      if (!pending) throw err
      if (pending.commit_id && pending.commit_id !== commit_id) {
        debug(
          `Reusing pending review ${pending.id} created for commit ${pending.commit_id} (current head ${commit_id}). Suggestions will attach to the older commit.`
        )
      } else {
        debug(`Reusing existing pending review ${pending.id} (duplicate 422).`)
      }
      return {
        id: pending.id,
        commitId: pending.commit_id || commit_id,
        reused: true,
      }
    }
  }

  /**
   * Attempt to add a single review comment.
   * Returns the created comment object on success, null if skipped due to the
   * known 422 "line must be part of the diff" error, otherwise throws.
   * @param {CreatedReview['id']} reviewId
   * @param {ReviewCommentDraft} comment
   * @returns {Promise<CreatedReviewComment | null>}
   */
  async function createReviewComment(reviewId, comment, targetCommitId) {
    try {
      const response = await octokit.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments',
        {
          ...prContext,
          review_id: reviewId,
          commit_id: targetCommitId,
          body: comment.body,
          path: comment.path,
          line: comment.line,
          side: /** @type {'RIGHT'} */ ('RIGHT'),
          ...(comment.start_line !== undefined && {
            start_line: comment.start_line,
            start_side: /** @type {'RIGHT'} */ ('RIGHT'),
          }),
        }
      )
      return response.data
    } catch (err) {
      if (isLineOutsideDiffError(err)) {
        info(
          `Could not create suggestion (line outside PR diff) for ${
            comment.path
          }:${formatLineRange(comment.start_line, comment.line)}`
        )
        return null
      }
      throw err
    }
  }

  /** Delete a pending review.
   * @param {CreatedReview['id']} review_id
   * @returns {Promise<void>}
   */
  async function deletePendingReview(review_id) {
    try {
      await octokit.pulls.deletePendingReview({ ...prContext, review_id })
    } catch (err) {
      debug(
        `Failed to delete pending review ${review_id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  try {
    await createReviewWithComments()
    return { comments, reviewCreated: true }
  } catch (err) {
    if (!isLineOutsideDiffError(err) && !isDuplicatePendingReviewError(err))
      throw err
    debug(
      isDuplicatePendingReviewError(err)
        ? 'Batch review creation failed (422: one pending review per pull request). Falling back to pending review salvage path.'
        : 'Batch review creation failed (422: line must be part of the diff). Falling back to pending review with per-comment adds.'
    )
  const { id: reviewId, commitId: salvageCommitId, reused } =
    await ensurePendingReview()
    if (reused && salvageCommitId !== commit_id) {
      debug(
        `Salvage path using reused review commit ${salvageCommitId}; diff generated for ${commit_id}. Potential line anchoring mismatches may occur.`
      )
    }
    let added = 0
    let skipped = 0
    for (const comment of comments) {
      const created = await createReviewComment(
        reviewId,
        comment,
        salvageCommitId
      )
      if (created) added++
      else skipped++
    }
    if (added === 0) {
      debug(
        'No review comments could be added; pending review will not be submitted.'
      )
      await deletePendingReview(reviewId)
      return { comments: [], reviewCreated: false }
    }
    await octokit.pulls.submitReview({
      ...prContext,
      review_id: reviewId,
      body,
      event,
    })
    debug(`Submitted salvage review (added: ${added}, skipped: ${skipped}).`)
    return { comments, reviewCreated: true }
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
