// @ts-check

import { getInput } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { Octokit } from "@octokit/action";

import { readFileSync } from "node:fs";
import parseGitDiff from "parse-git-diff";

// Get the diff between the head branch and the base branch
const diff = await getExecOutput("git", ["diff"], { silent: true });

// Create an array of changes from the diff output based on patches
const parsedDiff = parseGitDiff(diff.stdout);

// Get changed files from parsedDiff (changed files have type 'ChangedFile')
const changedFiles = parsedDiff.files.filter(
  (file) => file.type === "ChangedFile"
);

// Create an array of comments with suggested changes for each chunk of each changed file
const comments = changedFiles.flatMap(({ path, chunks }) =>
  chunks.map(({ fromFileRange, changes }) => ({
    path,
    start_line: fromFileRange.start,
    // The last line of the chunk is the start line plus the number of lines in the chunk
    // (minus 1 because the start line is included in the chunk)
    line: fromFileRange.start + fromFileRange.lines - 1,
    start_side: "RIGHT",
    side: "RIGHT",
    body: `\`\`\`\`suggestion\n${changes
      .filter(({ type }) => type === "AddedLine" || type === "UnchangedLine")
      .map(({ content }) => content)
      .join("\n")}\n\`\`\`\``,
  }))
);

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const eventPayload = JSON.parse(
  readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
);

octokit.pulls.createReview({
  owner,
  repo,
  pull_number: eventPayload.pull_request.number,
  event: "REQUEST_CHANGES",
  body: getInput('comment'),
  comments,
});
