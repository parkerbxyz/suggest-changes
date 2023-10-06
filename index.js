// @ts-check

import { getInput, setFailed } from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { Octokit } from '@octokit/action'

import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import parseGitDiff from 'parse-git-diff'

const octokit = new Octokit({
  userAgent: 'suggest-changes',
})

const [owner, repo] = String(env.GITHUB_REPOSITORY).split('/')
const eventPayload = JSON.parse(
  readFileSync(String(env.GITHUB_EVENT_PATH), 'utf8')
)

// Get the diff between the head branch and the base branch
const diff = await getExecOutput('git', ['diff'], { silent: true })

// Create an array of changes from the diff output based on patches
const parsedDiff = parseGitDiff(diff.stdout)

// Get changed files from parsedDiff (changed files have type 'ChangedFile')
const changedFiles = parsedDiff.files.filter(
  (/** @type {{ type: string; }} */ file) => file.type === 'ChangedFile'
)

const generateSuggestionBody = (changes) => {
  return changes
    .filter(({ type }) => type === 'AddedLine' || type === 'UnchangedLine')
    .map(({ content }) => content)
    .join('\n')
}

// Create an array of comments with suggested changes for each chunk of each changed file
const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks.map(({ fromFileRange, changes }) => ({
    path,
    start_line: fromFileRange.start,
    // The last line of the chunk is the start line plus the number of lines in the chunk
    // minus 1 to account for the start line being included in fromFileRange.lines
    line: fromFileRange.start + fromFileRange.lines - 1,
    start_side: 'RIGHT',
    side: 'RIGHT',
    // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
    // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
    body: `\`\`\`\`suggestion\n${generateSuggestionBody(changes)}\n\`\`\`\``,
  }))
)

octokit.pulls.createReview({
  owner,
  repo,
  pull_number: Number(eventPayload.pull_request.number),
  event: 'REQUEST_CHANGES',
  body: getInput('comment'),
  comments,
})
