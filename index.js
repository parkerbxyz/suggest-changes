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
  ['diff', '--unified=0', '--', ...pullRequestFiles],
  { silent: true }
)

debug(`Diff output: ${diff.stdout}`)

// Create an array of changes from the diff output based on patches
const parsedDiff = parseGitDiff(diff.stdout)

// Get changed files from parsedDiff (changed files have type 'ChangedFile')
const changedFiles = parsedDiff.files.filter(
  (file) => file.type === 'ChangedFile'
)

const generateSuggestionBody = (changes) => {
  const addedLines = changes.filter(({ type }) => type === 'AddedLine')
  const removedLines = changes.filter(({ type }) => type === 'RemovedLine')

  if (addedLines.length === 0) {
    return null // No added lines to suggest
  }

  // If we have both added and removed lines, only suggest lines that are actually different
  const linesToSuggest = removedLines.length > 0
    ? addedLines.filter(({ content }) => {
        const removedContent = new Set(removedLines.map(({ content }) => content))
        return !removedContent.has(content)
      })
    : addedLines // If only added lines (new content), include all of them

  if (linesToSuggest.length === 0) {
    return null // No actual content changes to suggest
  }

  const suggestionBody = linesToSuggest.map(({ content }) => content).join('\n')
  // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
  // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
  return `\`\`\`\`suggestion\n${suggestionBody}\n\`\`\`\``
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
  chunks
    .filter((chunk) => chunk.type === 'Chunk') // Only process regular chunks, not binary or combined chunks
    .flatMap(({ fromFileRange, changes }) => {
      debug(`Starting line: ${fromFileRange.start}`)
      debug(`Number of lines: ${fromFileRange.lines}`)
      debug(`Changes: ${JSON.stringify(changes)}`)

      // Generate the suggestion body for this chunk
      const suggestionBody = generateSuggestionBody(changes)

      // Skip if no suggestion was generated (no actual changes to suggest)
      if (!suggestionBody) {
        return []
      }

      // With --unified=0, always create single line comments to avoid hunk boundary issues
      const comment = {
        path,
        line: fromFileRange.start,
        body: suggestionBody,
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
  const event = getInput('event').toUpperCase()
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: /** @type {'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'} */ (event),
    body: getInput('comment'),
    comments,
  })
}
