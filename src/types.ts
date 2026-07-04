import type { Octokit } from '@octokit/action'
import type { Endpoints } from '@octokit/types'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import type {
  AddedLine,
  AnyLineChange,
  DeletedLine,
  UnchangedLine,
} from 'parse-git-diff'

// Re-export parse-git-diff types for convenience
export type { AddedLine, AnyLineChange, DeletedLine, UnchangedLine }

// GitHub API types
export type GetReviewComment =
  Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}/comments']['response']['data'][number]

export type ReviewCommentInput = NonNullable<
  Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['comments']
>[number]

export type PullRequestFile =
  Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}/files']['response']['data'][number]

export type ReviewEvent = NonNullable<
  Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['event']
>

// Re-export webhook types
export type { PullRequestEvent }

// Review comment with required line field
export interface ReviewCommentDraft extends ReviewCommentInput {
  line: number
}

// A maximal sequence of consecutive added/deleted lines within a hunk,
// with the unchanged lines immediately before and after it (when present)
export interface EditRun {
  deletedLines: DeletedLine[]
  addedLines: AddedLine[]
  precedingContext: UnchangedLine | undefined
  followingContext: UnchangedLine | undefined
}

// Action run configuration
export interface RunConfig {
  octokit: Octokit
  owner: string
  repo: string
  pull_number: number
  commit_id: string
  diff: string
  event: ReviewEvent
  body: string
}

// Action run result
export interface RunResult {
  comments: ReviewCommentDraft[]
  reviewCreated: boolean
  suggestionsPosted: number
  suggestionsRemaining: number
}

// Partition result
export interface PartitionResult<T> {
  pass: T[]
  fail: T[]
}

// Logging options
export interface LogOptions {
  logger?: (message: string) => void
  detailed?: boolean
}
