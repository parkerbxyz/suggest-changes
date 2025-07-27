// @ts-check

import { debug, getInput } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

/**
 * Type guard to check if a change is an AddedLine
 * @param {any} change - The change to check
 * @returns {change is AddedLine} True if the change is an AddedLine
 */
function isAddedLine(change) {
  return change?.type === 'AddedLine' && typeof change.lineAfter === 'number'
}

/**
 * Type guard to check if a change is a DeletedLine
 * @param {any} change - The change to check
 * @returns {change is DeletedLine} True if the change is a DeletedLine
 */
function isDeletedLine(change) {
  return change?.type === 'DeletedLine' && typeof change.lineBefore === 'number'
}

/**
 * Type guard to check if a change is an UnchangedLine
 * @param {any} change - The change to check
 * @returns {change is UnchangedLine} True if the change is an UnchangedLine
 */
function isUnchangedLine(change) {
  return (
    change?.type === 'UnchangedLine' &&
    typeof change.lineBefore === 'number' &&
    typeof change.lineAfter === 'number'
  )
}

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
 * @param {AnyLineChange[]} changes
 * @returns {SuggestionBody | null}
 */
const generateSuggestionBody = (changes) => {
  const addedLines = changes.filter(isAddedLine)
  const deletedLines = changes.filter(isDeletedLine)
  const unchangedLines = changes.filter(isUnchangedLine)

  // Handle pure deletions (only deleted lines)
  if (addedLines.length === 0 && deletedLines.length > 0) {
    // For deletions, include context to make the suggestion clearer
    const contextLine = unchangedLines.length > 0 ? unchangedLines[0] : null

    // Build the suggestion content
    const suggestionBody = contextLine ? contextLine.content : ''
    const lineCount = contextLine ? 1 : deletedLines.length

    return {
      body: createSuggestion(suggestionBody),
      lineCount,
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

  // For pure additions (no deletions), include context to make the suggestion clearer
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

// Fetch existing review comments
const existingComments = (
  await octokit.pulls.listReviewComments({ owner, repo, pull_number })
).data

// Function to generate a unique key for a comment
/**
 * @param {PostReviewComment | GetReviewComment} comment
 * @returns {string}
 */
const generateCommentKey = (comment) =>
  `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${
    comment.body
  }`

// Create a Set of existing comment keys for faster lookup
const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

// Create an array of comments with suggested changes for each chunk of each changed file
const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks
    .filter((chunk) => chunk.type === 'Chunk') // Only process regular chunks
    .flatMap(({ fromFileRange, changes }) => {
      debug(`Starting line (HEAD): ${fromFileRange.start}`)
      debug(`Number of lines: ${fromFileRange.lines}`)
      debug(`Changes: ${JSON.stringify(changes)}`)

      // Generate the suggestion body for this chunk
      const suggestionBody = generateSuggestionBody(changes)

      // Skip if no suggestion was generated (no actual changes to suggest)
      if (!suggestionBody) {
        return []
      }

      const { body, lineCount } = suggestionBody

      // Create appropriate comment based on line count
      // Use the actual line numbers from AddedLine.lineAfter for correct targeting
      const addedLines = changes.filter(isAddedLine)
      const unchangedLines = changes.filter(isUnchangedLine)

      // Determine the starting line for the comment
      const startLine =
        addedLines.length > 0
          ? addedLines[0].lineAfter // Use the actual line number where the first addition appears
          : unchangedLines.length > 0
          ? unchangedLines[0].lineAfter // For pure deletions with context, use the unchanged line's position
          : null // Skip suggestions for deletions without context

      if (!startLine) {
        // Skip suggestions for deletions without context - they're usually not actionable
        return []
      }

      const endLine = startLine + lineCount - 1

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
  isAddedLine
}
