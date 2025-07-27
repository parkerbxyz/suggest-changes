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
 * @returns {Array<{body: string, lineAfter: number, startLineAfter?: number}>}
 */
const generateIndividualSuggestions = (changes) => {
  const addedLines = changes.filter(isAddedLine)
  const deletedLines = changes.filter(isDeletedLine)

  // Filter out added lines that are identical to deleted lines (no real change)
  const meaningfulAddedLines = addedLines.filter(addedLine => {
    return deletedLines.length === 0 || 
      !deletedLines.some(deletedLine => deletedLine.content === addedLine.content)
  })

  const suggestions = []

  if (meaningfulAddedLines.length === 0 && deletedLines.length > 0) {
    // Handle pure deletions
    const unchangedLines = changes.filter(isUnchangedLine)
    const firstDeletedLine = deletedLines[0].lineBefore
    const contextLine = unchangedLines.find(line => line.lineBefore < firstDeletedLine)
    
    if (contextLine) {
      suggestions.push({
        body: createSuggestion(''),
        lineAfter: contextLine.lineAfter
      })
    }
  } else if (meaningfulAddedLines.length > 0) {
    // Group consecutive added lines into multi-line suggestions
    const groups = []
    let currentGroup = [meaningfulAddedLines[0]]

    for (let i = 1; i < meaningfulAddedLines.length; i++) {
      const currentLine = meaningfulAddedLines[i]
      const previousLine = meaningfulAddedLines[i - 1]
      
      // Check if this line is consecutive to the previous one
      if (currentLine.lineAfter === previousLine.lineAfter + 1) {
        currentGroup.push(currentLine)
      } else {
        // Start a new group
        groups.push(currentGroup)
        currentGroup = [currentLine]
      }
    }
    groups.push(currentGroup) // Don't forget the last group

    // Create suggestions for each group
    for (const group of groups) {
      if (group.length === 1) {
        // Single line suggestion
        suggestions.push({
          body: createSuggestion(group[0].content),
          lineAfter: group[0].lineAfter
        })
      } else {
        // Multi-line suggestion
        const content = group.map(line => line.content).join('\n')
        suggestions.push({
          body: createSuggestion(content),
          lineAfter: group[group.length - 1].lineAfter, // End line
          startLineAfter: group[0].lineAfter // Start line
        })
      }
    }
  }

  return suggestions
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
    .flatMap(({ fromFileRange, toFileRange, changes }) => {
      debug(`Starting line (HEAD): ${fromFileRange.start}`)
      debug(`Number of lines: ${fromFileRange.lines}`)
      debug(`Target range: ${JSON.stringify(toFileRange)}`)
      debug(`Changes: ${JSON.stringify(changes)}`)

      // Generate individual suggestions for this chunk
      const suggestions = generateIndividualSuggestions(changes)

      // Skip if no suggestions were generated
      if (suggestions.length === 0) {
        return []
      }

      // Create review comments for each suggestion
      return suggestions.map(({ body, lineAfter, startLineAfter }) => {
        const comment = startLineAfter
          ? {
              path,
              start_line: startLineAfter,
              line: lineAfter,
              body: body,
            }
          : {
              path,
              line: lineAfter,
              body: body,
            }

        // Generate key for the new comment
        const commentKey = generateCommentKey(comment)

        // Check if the new comment already exists
        if (existingCommentKeys.has(commentKey)) {
          return null
        }

        return comment
      }).filter(comment => comment !== null)
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
export { createSuggestion, generateCommentKey, generateIndividualSuggestions, isAddedLine }
