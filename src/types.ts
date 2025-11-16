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

export type ReviewEvent = NonNullable<
  Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']['event']
>

// Re-export webhook types
export type { PullRequestEvent }

// Review comment with required line field
export interface ReviewCommentDraft extends ReviewCommentInput {
  line: number
}

// Suggestion body with metadata
export interface SuggestionBody {
  body: string
  lineCount: number
}

// Line positioning for suggestions
export interface LinePosition {
  startLine: number
  endLine: number
}

// Line movement detection result
export interface LineMovement {
  deleted: DeletedLine
  added: AddedLine
}

// Filtered change types
export interface FilteredChanges {
  addedLines: AddedLine[]
  deletedLines: DeletedLine[]
  unchangedLines: UnchangedLine[]
}

// Action run configuration
export interface RunConfig {
  octokit: any // Using any to avoid importing full Octokit type
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
