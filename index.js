// @ts-check

import { debug, getInput } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

/** @typedef {import('parse-git-diff').AnyLineChange} AnyLineChange */
/** @typedef {import('parse-git-diff').AddedLine} AddedLine */
/** @typedef {import('parse-git-diff').DeletedLine} DeletedLine */
/** @typedef {import('parse-git-diff').UnchangedLine} UnchangedLine */
/** @typedef {import('@octokit/types').Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}/comments']['response']['data'][number]} GetReviewComment */
/** @typedef {NonNullable<import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['comments']>[number]} PostReviewComment */
/** @typedef {import("@octokit/webhooks-types").PullRequestEvent} PullRequestEvent */
/** @typedef {import('@octokit/types').Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['event']} ReviewEvent */

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
export function isAddedLine(change) {
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
 * @param {string} content
 * @returns {string}
 */
export const createSuggestion = (content) => {
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${content}\n\`\`\`\``
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
 * Separate standalone deletions from mixed changes within a contiguous group.
 *
 * This function intelligently separates deletions that should be standalone suggestions
 * from those that should be grouped with additions as replacement suggestions.
 *
 * Logic:
 * - Non-empty deletions: Always paired with additions when available (content replacement)
 * - Empty line deletions: Usually standalone (cleanup), except for small structural changes
 *
 * @param {AnyLineChange[]} group - A contiguous group of changes from proximity grouping
 * @returns {AnyLineChange[][]} Array of separated suggestion groups
 */
const separateStandaloneDeletions = (group) => {
  const { addedLines, deletedLines, unchangedLines } =
    filterChangesByType(group)

  // Pure groups (only deletions OR only additions) don't need separation
  if (deletedLines.length === 0 || addedLines.length === 0) {
    return [group]
  }

  // Split deletions into standalone and paired based on content and context
  const standaloneDeletes = []
  const pairedDeletes = []

  deletedLines.forEach((deleted) => {
    // Non-empty deletions should be paired with additions for content replacement
    if (deleted.content.trim() !== '') {
      if (addedLines.length === 0) {
        standaloneDeletes.push(deleted)
      } else {
        pairedDeletes.push(deleted)
      }
      return
    }

    // Empty line deletions are usually standalone cleanup suggestions,
    // except when they're part of small structural changes
    const isSmallGroupWithSingleAddition =
      group.length <= 5 && addedLines.length === 1
    if (!isSmallGroupWithSingleAddition) {
      standaloneDeletes.push(deleted)
    } else {
      pairedDeletes.push(deleted)
    }
  })

  // Build result: standalone deletions as individual suggestions,
  // paired content as combined suggestions
  const result = [
    ...standaloneDeletes.map((deleted) => [deleted]),
    ...(unchangedLines.length > 0 ||
    pairedDeletes.length > 0 ||
    addedLines.length > 0
      ? [[...unchangedLines, ...pairedDeletes, ...addedLines]]
      : []),
  ]

  return result.length > 0 ? result : [group]
}

/**
 * Group changes into logical suggestion groups based on line proximity.
 *
 * The algorithm works in two phases:
 * 1. Group changes by line proximity (contiguous or nearly contiguous lines)
 * 2. Separate standalone deletions from mixed content within each group
 *
 * This ensures that:
 * - Related changes (like replacing content) are grouped together
 * - Unrelated changes (like cleanup deletions) remain separate
 * - Multi-line changes get proper start/end positioning
 *
 * @param {AnyLineChange[]} changes - Array of line changes from git diff
 * @returns {AnyLineChange[][]} Array of suggestion groups
 */
export const groupChangesForSuggestions = (changes) => {
  if (changes.length === 0) return []

  // Phase 1: Group by line proximity using appropriate coordinate systems
  // - Deletions use lineBefore (original file line numbers)
  // - Additions use lineAfter (new file line numbers)
  // - Unchanged use lineBefore (context positioning)
  const groups = []
  let currentGroup = []
  let lastLineNumber = null

  for (const change of changes) {
    const lineNumber = isDeletedLine(change)
      ? change.lineBefore
      : isAddedLine(change)
      ? change.lineAfter
      : isUnchangedLine(change)
      ? change.lineBefore
      : null

    if (lineNumber === null) continue

    // Start new group if there's a line gap (non-contiguous changes)
    if (lastLineNumber !== null && lineNumber > lastLineNumber + 1) {
      groups.push(currentGroup)
      currentGroup = []
    }

    currentGroup.push(change)
    lastLineNumber = lineNumber
  }

  if (currentGroup.length > 0) groups.push(currentGroup)

  // Phase 2: Separate standalone deletions from mixed changes within each group
  return groups.flatMap((group) => separateStandaloneDeletions(group))
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
    lineCount: Math.max(deletedLines.length, addedLines.length),
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
  const { deletedLines, unchangedLines } = filterChangesByType(groupChanges)

  let startLine

  // Try to find the best target line in order of preference
  if (deletedLines.length > 0) {
    startLine = deletedLines[0].lineBefore
  } else if (unchangedLines.length > 0) {
    // Pure additions with context - position on the context line
    startLine = unchangedLines[0].lineBefore
  } else {
    // Pure additions without context - use file range
    startLine = fromFileRange.start
  }

  return { startLine, endLine: startLine + lineCount - 1 }
}

/**
 * Function to generate a unique key for a comment
 * @param {PostReviewComment | GetReviewComment} comment
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
 * @returns {Array<{path: string, body: string, line: number, start_line?: number, start_side?: string}>} Generated comments
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
 * @returns {Array<{path: string, body: string, line: number, start_line?: number, start_side?: string}>} Generated comments
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
    const isMultiLine = lineCount > 1
    const comment = {
      path,
      body,
      line: endLine,
      ...(isMultiLine && { start_line: startLine, start_side: 'RIGHT' }),
    }

    // Skip if comment already exists
    const commentKey = generateCommentKey(comment)
    return existingCommentKeys.has(commentKey) ? [] : [comment]
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
 * @param {string} options.diffOutput - Git diff output
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
  diffOutput,
  event,
  body,
}) {
  debug(`Diff output: ${diffOutput}`)

  const parsedDiff = parseGitDiff(diffOutput)

  const existingComments = (
    await octokit.pulls.listReviewComments({ owner, repo, pull_number })
  ).data

  const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

  const comments = generateReviewComments(parsedDiff, existingCommentKeys)

  // Create a review with the suggested changes if there are any
  if (comments.length > 0) {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number,
      commit_id,
      body,
      event,
      comments,
    })
  }

  return { comments, reviewCreated: comments.length > 0 }
}

// Only run main logic when this file is executed directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const octokit = new Octokit({
    userAgent: 'suggest-changes',
  })

  const [owner, repo] = String(env.GITHUB_REPOSITORY).split('/')

  /** @type {PullRequestEvent} */
  const eventPayload = JSON.parse(
    readFileSync(String(env.GITHUB_EVENT_PATH), 'utf8')
  )

  const pull_number = Number(eventPayload.pull_request.number)
  const commit_id = eventPayload.pull_request.head.sha

  const pullRequestFiles = (
    await octokit.pulls.listFiles({ owner, repo, pull_number })
  ).data.map((file) => file.filename)

  // Get the diff between the head branch and the base branch (limit to the files in the pull request)
  const diff = await getExecOutput(
    'git',
    // The '--ignore-cr-at-eol' flag ignores carriage return differences at line endings
    // to prevent unnecessary suggestions from cross-platform line ending variations.
    ['diff', '--unified=1', '--ignore-cr-at-eol', '--', ...pullRequestFiles],
    { silent: true }
  )

  const event = /** @type {ReviewEvent} */ (getInput('event').toUpperCase())
  const body = getInput('comment')

  await run({
    octokit,
    owner,
    repo,
    pull_number,
    commit_id,
    diffOutput: diff.stdout,
    event,
    body,
  })
}
