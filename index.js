// @ts-check

import { debug, getInput } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

const octokit = new Octokit({
  userAgent: 'suggest-changes',
})

const [owner, repo] = String(env.GITHUB_REPOSITORY).split('/')

/** @type {import("@octokit/webhooks-types").PullRequestEvent} */
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
  ['diff', '--unified=1', '--', ...pullRequestFiles],
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
 * Generates a suggestion body for GitHub comments from an array of line changes.
 *
 * @param {import("parse-git-diff").AnyLineChange[]} changes - An array of line changes.
 * @returns {string} The formatted suggestion body as a string.
 */
const generateSuggestionBody = (changes) => {
  const suggestionBody = changes
    .filter(({ type }) => type === 'AddedLine' || type === 'UnchangedLine')
    .map(({ content }) => content)
    .join('\n')
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${suggestionBody}\n\`\`\`\``
}

function createSingleLineComment(path, fromFileRange, changes) {
  return {
    path,
    line: fromFileRange.start,
    body: generateSuggestionBody(changes),
  }
}

function createMultiLineComment(path, fromFileRange, changes) {
  // Filter out deleted lines
  const filteredChanges = changes.filter(
    ({ type }) => type === 'AddedLine' || type === 'UnchangedLine'
  )

  // Determine the new start and end lines
  const startLine = fromFileRange.start + changes.findIndex(
    ({ type }) => type === 'AddedLine' || type === 'UnchangedLine'
  )
  const endLine = fromFileRange.start + changes.length - 1 - [...changes].reverse().findIndex(
    ({ type }) => type === 'AddedLine' || type === 'UnchangedLine'
  )

  return {
    path,
    start_line: startLine,
    line: endLine,
    start_side: 'RIGHT',
    side: 'RIGHT',
    body: generateSuggestionBody(filteredChanges),
  }
}

// Fetch existing review comments
const existingComments = (
  await octokit.pulls.listReviewComments({ owner, repo, pull_number })
).data

// Function to generate a unique key for a comment
const generateCommentKey = (comment) =>
  `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${
    comment.body
  }`

// Create a Set of existing comment keys for faster lookup
const existingCommentKeys = new Set(existingComments.map(generateCommentKey))

// Create an array of comments with suggested changes for each chunk of each changed file
const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks.flatMap(({ fromFileRange, changes }) => {
    debug(`Starting line: ${fromFileRange.start}`)
    debug(`Number of lines: ${fromFileRange.lines}`)
    debug(`Changes: ${JSON.stringify(changes)}`)

    const comment =
      fromFileRange.lines <= 1
        ? createSingleLineComment(path, fromFileRange, changes)
        : createMultiLineComment(path, fromFileRange, changes)

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
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: 'REQUEST_CHANGES',
    body: getInput('comment'),
    comments,
  })
}
