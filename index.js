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
 * @param {string} content
 * @returns {string}
 */
const createSuggestion = (content) => {
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${content}\n\`\`\`\``
}

/**
 * Group changes into contiguous blocks separated by line gaps.
 * This prevents independent changes (like separate trailing space fixes)
 * from being combined into a single suggestion that would contain duplicate content.
 *
 * @param {AnyLineChange[]} changes - Array of line changes from git diff
 * @returns {AnyLineChange[][]} Array of contiguous change groups
 * @example
 * // Changes on lines 1, 2, 5, 6 would be grouped as: [[line1, line2], [line5, line6]]
 */
const groupContiguousChanges = (changes) => {
  if (changes.length === 0) return []

  const groups = []
  let currentGroup = []
  let lastLineNumber = null

  for (const change of changes) {
    // Get the line number for positioning (use lineBefore for deletions, lineAfter for additions)
    const lineNumber = isDeletedLine(change)
      ? change.lineBefore
      : isAddedLine(change)
      ? change.lineAfter
      : isUnchangedLine(change)
      ? change.lineBefore
      : null

    if (lineNumber === null) {
      continue // Skip changes we can't position
    }

    // Start a new group if this is the first change or if there's a gap
    if (lastLineNumber === null || lineNumber > lastLineNumber + 1) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      currentGroup = [change]
    } else {
      // Add to current group if contiguous
      currentGroup.push(change)
    }

    lastLineNumber = lineNumber
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * Get lines that are actually different (not duplicates of deleted content)
 * @param {AddedLine[]} addedLines - Array of added lines
 * @param {DeletedLine[]} deletedLines - Array of deleted lines
 * @returns {AddedLine[]} Lines that represent actual changes
 */
const getLinesToSuggest = (addedLines, deletedLines) => {
  if (deletedLines.length === 0) {
    return addedLines
  }

  const deletedContent = new Set(deletedLines.map(({ content }) => content))

  return addedLines.filter(({ content }) => !deletedContent.has(content))
}

/**
 * Find a deleted line that matches the suggested content
 * @param {DeletedLine[]} deletedLines - Array of deleted lines
 * @param {string} suggestedContent - Content to match against
 * @returns {DeletedLine | null} Matching deleted line or null
 */
const findMatchingDeletedLine = (deletedLines, suggestedContent) => {
  return (
    deletedLines.find(
      (deleted) => deleted.content.trim() === suggestedContent.trim()
    ) || null
  )
}

/**
 * @param {AnyLineChange[]} changes
 * @returns {SuggestionBody | null}
 */
const generateSuggestionBody = (changes) => {
  const addedLines = changes.filter(isAddedLine)
  const deletedLines = changes.filter(isDeletedLine)
  const unchangedLines = changes.filter(isUnchangedLine)

  // Handle pure deletions (only deleted lines)
  if (addedLines.length === 0 && deletedLines.length > 0) {
    return {
      body: createSuggestion(''),
      lineCount: deletedLines.length,
    }
  }

  if (addedLines.length === 0) {
    return null // No changes to suggest
  }

  const linesToSuggest = getLinesToSuggest(addedLines, deletedLines)

  if (linesToSuggest.length === 0) {
    return null // No actual content changes to suggest
  }

  // For pure additions (no deletions), use the first unchanged line as context
  // to show reviewers where the new additions should be placed
  const isPureAddition = deletedLines.length === 0
  const contextLine =
    isPureAddition && unchangedLines.length > 0 ? unchangedLines[0] : null

  const suggestionLines = contextLine
    ? [contextLine.content, ...linesToSuggest.map(({ content }) => content)]
    : linesToSuggest.map(({ content }) => content)

  const suggestionBody = suggestionLines.join('\n')

  // For pure additions with context, we want to position the comment on just the context line
  // The suggestion will show the context + new content, but only affect the context line
  const lineCount = contextLine ? 1 : linesToSuggest.length

  return {
    body: createSuggestion(suggestionBody),
    lineCount,
  }
}

/**
 * Calculate line positioning for GitHub review comments.
 * GitHub requires line numbers that exist in the PR head (the "before" state).
 * We need to handle different scenarios: deletions, additions, and mixed changes.
 * @param {AnyLineChange[]} groupChanges - The changes in this group
 * @param {number} lineCount - Number of lines the suggestion spans
 * @param {{start: number}} fromFileRange - File range information
 * @returns {{startLine: number, endLine: number}} Line positioning
 */
const calculateLinePosition = (groupChanges, lineCount, fromFileRange) => {
  const addedLines = groupChanges.filter(isAddedLine)
  const deletedLines = groupChanges.filter(isDeletedLine)
  const unchangedLines = groupChanges.filter(isUnchangedLine)

  let startLine

  if (deletedLines.length > 0) {
    // SCENARIO 1: Changes with deletions
    // Position the comment on a deleted line that exists in the PR head
    let targetDeletedLine = deletedLines[0]

    if (addedLines.length > 0) {
      // For mixed changes (deletions + additions), try to find the most relevant deleted line
      const linesToSuggest = getLinesToSuggest(addedLines, deletedLines)

      if (linesToSuggest.length > 0) {
        // Try to find a deleted line that corresponds to our suggested content
        const suggestedContent = linesToSuggest[0].content
        const matchingDeleted = findMatchingDeletedLine(
          deletedLines,
          suggestedContent
        )
        if (matchingDeleted) {
          targetDeletedLine = matchingDeleted
        }
      }
    }

    startLine = targetDeletedLine.lineBefore
  } else if (unchangedLines.length > 0) {
    // SCENARIO 2: Pure additions with context
    // Position on the unchanged line in PR head. The context is included in the suggestion body for clarity.
    startLine = unchangedLines[0].lineBefore
  } else {
    // SCENARIO 3: Pure additions without context
    // Use fromFileRange as fallback positioning
    startLine = fromFileRange.start
  }

  const endLine = startLine + lineCount - 1
  return { startLine, endLine }
}

/**
 * Function to generate a unique key for a comment
 * @param {PostReviewComment | GetReviewComment} comment
 * @returns {string}
 */
const generateCommentKey = (comment) =>
  `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${
    comment.body
  }`

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

debug(`Diff output: ${diff.stdout}`)

const parsedDiff = parseGitDiff(diff.stdout)

const changedFiles = parsedDiff.files.filter(
  (file) => file.type === 'ChangedFile'
)

const existingComments = (
  await octokit.pulls.listReviewComments({ owner, repo, pull_number })
).data

const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks
    .filter((chunk) => chunk.type === 'Chunk') // Only process regular chunks
    .flatMap(({ fromFileRange, changes }) => {
      debug(`Starting line: ${fromFileRange.start}`)
      debug(`Number of lines: ${fromFileRange.lines}`)
      debug(`Changes: ${JSON.stringify(changes)}`)

      // Group changes into contiguous blocks
      const contiguousGroups = groupContiguousChanges(changes)

      // Process each contiguous group separately
      return contiguousGroups.flatMap((groupChanges) => {
        // Generate the suggestion body for this group
        const suggestionBody = generateSuggestionBody(groupChanges)

        // Skip if no suggestion was generated (no actual changes to suggest)
        if (!suggestionBody) {
          return []
        }

        const { body, lineCount } = suggestionBody
        const { startLine, endLine } = calculateLinePosition(
          groupChanges,
          lineCount,
          fromFileRange
        )

        // GitHub requires different comment structures for the review endpoint:
        // - Single-line: {path, body, line}
        // - Multi-line: {path, body, line, start_line, start_side} where start_line < line
        // We use conditional spread to add start_line and start_side to multi-line comments
        const isMultiLine = lineCount > 1
        const comment = {
          path,
          body,
          line: endLine,
          ...(isMultiLine && { start_line: startLine }),
          ...(isMultiLine && { start_side: 'RIGHT' }),
        }

        // Check if the new comment already exists
        const commentKey = generateCommentKey(comment)
        if (existingCommentKeys.has(commentKey)) {
          return []
        }

        return [comment]
      })
    })
)

// Create a review with the suggested changes if there are any
if (comments.length > 0) {
  const event = /** @type {ReviewEvent} */ (getInput('event').toUpperCase())
  const body = getInput('comment')
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

// Export for testing
export {
  calculateLinePosition,
  createSuggestion,
  findMatchingDeletedLine,
  generateCommentKey,
  generateSuggestionBody,
  getLinesToSuggest,
  groupContiguousChanges,
  isAddedLine
}
