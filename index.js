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
// Set context=0 so suggestions are inline with the changed code to avoid running into the error
// "Applying suggestions on deleted lines is not supported"
const diff = await getExecOutput(
  'git',
  ['diff', '-U0', '--', ...pullRequestFiles],
  {
    silent: true,
  }
)

// Create an array of changes from the diff output based on patches
const parsedDiff = parseGitDiff(diff.stdout)

// Get changed files from parsedDiff (changed files have type 'ChangedFile')
const changedFiles = parsedDiff.files.filter(
  (/** @type {{ type: string; }} */ file) => file.type === 'ChangedFile'
)

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
  return {
    path,
    start_line: fromFileRange.start,
    // The last line of the chunk is the start line plus the number of lines in the chunk
    // minus 1 to account for the start line being included in fromFileRange.lines
    line: fromFileRange.start + fromFileRange.lines - 1,
    start_side: 'RIGHT',
    side: 'RIGHT',
    body: generateSuggestionBody(changes),
  }
}

// Create an array of comments with suggested changes for each chunk of each changed file
const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks.map(({ fromFileRange, changes }) => {
    debug(`Starting line: ${fromFileRange.start}`)
    debug(`Number of lines: ${fromFileRange.lines}`)
    if (fromFileRange.start === fromFileRange.lines || changes.length === 2) {
      return createSingleLineComment(path, fromFileRange, changes)
    } else {
      return createMultiLineComment(path, fromFileRange, changes)
    }
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
