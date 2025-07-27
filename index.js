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
 * @param {AnyLineChange[]} changes
 * @returns {SuggestionBody | null}
 */
const generateSuggestionBody = (changes) => {
  const addedLines = changes.filter(isAddedLine)
  const deletedLines = changes.filter(isDeletedLine)
  const unchangedLines = changes.filter(isUnchangedLine)

  // Handle pure deletions (only deleted lines)
  if (addedLines.length === 0 && deletedLines.length > 0) {
    // For deletions, suggest empty content (which will delete the lines)
    return {
      body: createSuggestion(''),
      lineCount: deletedLines.length,
    }
  }

  if (addedLines.length === 0) {
    return null // No changes to suggest
  }

  // If we have both added and deleted lines, only suggest lines that are actually different
  const linesToSuggest =
    deletedLines.length > 0
      ? addedLines.filter(({ content }) => {
          const deletedContent = new Set(
            deletedLines.map(({ content }) => content)
          )
          return !deletedContent.has(content)
        })
      : addedLines // If only added lines (new content), include all of them

  if (linesToSuggest.length === 0) {
    return null // No actual content changes to suggest
  }

  // For pure additions (no deletions), use the first unchanged line as context
  // to show reviewers where the new additions should be placed
  const isPureAddition = deletedLines.length === 0
  const contextLine =
    isPureAddition && unchangedLines.length > 0 ? unchangedLines[0] : null

  // Build the suggestion content
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

const pullRequestFiles = (
  await octokit.pulls.listFiles({ owner, repo, pull_number })
).data.map((file) => file.filename)

// Get the diff between the head branch and the base branch (limit to the files in the pull request)
const diff = await getExecOutput(
  'git',
  // The '--ignore-cr-at-eol' flag ensures that differences in line-ending styles (e.g., CRLF vs. LF)
  // are ignored when generating the diff. This prevents unnecessary or no-op suggestions caused by
  // line-ending mismatches, which can occur in cross-platform environments.
  ['diff', '--unified=1', '--ignore-cr-at-eol', '--', ...pullRequestFiles],
  { silent: true }
)

debug(`Diff output: ${diff.stdout}`)

// Create an array of changes from the diff output based on patches
const parsedDiff = parseGitDiff(diff.stdout)

// Get changed files from parsedDiff (changed files have type 'ChangedFile')
const changedFiles = parsedDiff.files.filter(
  (file) => file.type === 'ChangedFile'
)

// Fetch existing review comments
const existingComments = (
  await octokit.pulls.listReviewComments({ owner, repo, pull_number })
).data

// Create a Set of existing comment keys for faster lookup
const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

// Create an array of comments with suggested changes for each chunk of each changed file
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

        // Calculate the correct line position for GitHub review comments.
        // GitHub requires line numbers that exist in the PR head (the "before" state).
        // We need to handle different scenarios: deletions, additions, and mixed changes.
        const addedLines = groupChanges.filter(isAddedLine)
        const deletedLines = groupChanges.filter(isDeletedLine)
        const unchangedLines = groupChanges.filter(isUnchangedLine)

        let startLine, endLine

        if (deletedLines.length > 0) {
          // SCENARIO 1: Changes with deletions
          // Position the comment on a deleted line that exists in the PR head
          let targetDeletedLine = deletedLines[0] // fallback to first

          if (addedLines.length > 0) {
            // For mixed changes (deletions + additions), try to find the most relevant deleted line
            // Recreate the same logic from generateSuggestionBody to find what we're actually suggesting
            const linesToSuggest = addedLines.filter(({ content }) => {
              const deletedContent = new Set(
                deletedLines.map(({ content }) => content)
              )
              return !deletedContent.has(content)
            })

            if (linesToSuggest.length > 0) {
              // Try to find a deleted line that corresponds to our suggested content
              const suggestedContent = linesToSuggest[0].content
              const matchingDeleted = deletedLines.find(
                (deleted) =>
                  // Look for a deleted line with similar content (ignoring leading/trailing whitespace)
                  deleted.content.trim() === suggestedContent.trim()
              )
              if (matchingDeleted) {
                targetDeletedLine = matchingDeleted
              }
            }
          }

          startLine = targetDeletedLine.lineBefore
          endLine = startLine + lineCount - 1
        } else if (unchangedLines.length > 0) {
          // SCENARIO 2: Pure additions with context
          // Position on the unchanged line in PR head. The context is included in the suggestion body for clarity.
          startLine = unchangedLines[0].lineBefore
          endLine = startLine + lineCount - 1
        } else {
          // SCENARIO 3: Pure additions without context
          // Use fromFileRange as fallback positioning
          startLine = fromFileRange.start
          endLine = startLine + lineCount - 1
        }

        // Create appropriate comment based on line count
        const comment =
          lineCount === 1
            ? {
                path,
                line: startLine,
                body: body,
              }
            : {
                path,
                start_line: startLine,
                line: endLine,
                body: body,
              }

        // Generate key for the new comment
        const commentKey = generateCommentKey(comment)

        // Check if the new comment already exists
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
    event,
    body,
    comments,
  })
}

// Export for testing
export {
  createSuggestion,
  generateCommentKey,
  generateSuggestionBody,
  groupContiguousChanges,
  isAddedLine
}
