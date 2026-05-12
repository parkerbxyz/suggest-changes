import assert from 'node:assert'
import { describe, test } from 'node:test'
import { run } from '../src/index.ts'

type ReviewParams = {
  body: string
  comments: Array<{
    path: string
    line: number
    start_line?: number
    body: string
  }>
}

/**
 * @param {number} count
 * @returns {Array<{path: string}>}
 */
function createMockFiles(count) {
  return Array.from({ length: count }, (_, i) => ({ path: `file${i}.md` }))
}

/**
 * @param {Array<{path: string}>} files
 * @returns {string}
 */
function createMockDiff(files) {
  return files
    .map(
      (file, i) =>
        `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,1 +1,1 @@\n-old line ${i}\n+new line ${i}`
    )
    .join('\n')
}

function createMockOctokit({
  existingComments = [],
  listReviewComments,
  createReview,
}: {
  existingComments?: ReviewParams['comments']
  listReviewComments?: () => Promise<ReviewParams['comments']>
  createReview?: (params: ReviewParams) => Promise<unknown>
} = {}) {
  const list = listReviewComments ?? (async () => existingComments)
  return {
    paginate: async (fn: unknown) => {
      if (fn !== list) throw new Error('Unexpected paginate target')
      return list()
    },
    pulls: {
      listReviewComments: list,
      createReview:
        createReview ??
        (async (_params: ReviewParams) => ({
          data: { id: 1 },
        })),
    },
  }
}

describe('review comment limit', () => {
  test('creates one review capped at 100 comments', async () => {
    const files = createMockFiles(150)
    const createdReviews: ReviewParams[] = []

    const result = await run({
      octokit: createMockOctokit({
        createReview: async (params) => {
          createdReviews.push(params)
          return { data: { id: createdReviews.length } }
        },
      }),
      owner: 'test',
      repo: 'test',
      pull_number: 1,
      commit_id: 'abc123',
      diff: createMockDiff(files),
      event: 'COMMENT',
      body: 'Please fix',
    })

    assert.strictEqual(createdReviews.length, 1)
    assert.strictEqual(createdReviews[0].comments.length, 100)
    assert.ok(createdReviews[0].body.includes('Posted 100 of 150'))
    assert.strictEqual(result.reviewCreated, true)
    assert.strictEqual(result.comments.length, 100)
    assert.strictEqual(result.comments[0].path, 'file0.md')
    assert.strictEqual(result.comments[99].path, 'file99.md')
  })

  test('dedupes existing comments before applying the cap', async () => {
    const files = createMockFiles(150)
    const firstRunReviews: ReviewParams[] = []

    await run({
      octokit: createMockOctokit({
        createReview: async (params) => {
          firstRunReviews.push(params)
          return { data: { id: firstRunReviews.length } }
        },
      }),
      owner: 'test',
      repo: 'test',
      pull_number: 1,
      commit_id: 'abc123',
      diff: createMockDiff(files),
      event: 'COMMENT',
      body: 'Please fix',
    })

    const secondRunReviews: ReviewParams[] = []
    const result = await run({
      octokit: createMockOctokit({
        existingComments: firstRunReviews[0].comments,
        createReview: async (params) => {
          secondRunReviews.push(params)
          return { data: { id: secondRunReviews.length } }
        },
      }),
      owner: 'test',
      repo: 'test',
      pull_number: 1,
      commit_id: 'abc123',
      diff: createMockDiff(files),
      event: 'COMMENT',
      body: 'Please fix',
    })

    assert.strictEqual(secondRunReviews.length, 1)
    assert.strictEqual(secondRunReviews[0].comments.length, 50)
    assert.strictEqual(result.comments[0].path, 'file100.md')
    assert.strictEqual(result.comments[49].path, 'file149.md')
  })

  test('returns no posted comments on 403 secondary rate limit', async () => {
    const error = Object.assign(
      new Error(
        'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'
      ),
      { status: 403, response: { headers: {} } }
    )

    const result = await run({
      octokit: createMockOctokit({
        createReview: async () => {
          throw error
        },
      }),
      owner: 'test',
      repo: 'test',
      pull_number: 1,
      commit_id: 'abc123',
      diff: createMockDiff(createMockFiles(1)),
      event: 'COMMENT',
      body: 'Review',
    })

    assert.strictEqual(result.reviewCreated, false)
    assert.strictEqual(result.comments.length, 0)
  })

  test('dedupes duplicate suggestions generated within a single run', async () => {
    // Two diff hunks producing the same path/line/suggestion should collapse to one comment.
    const diff = [
      `diff --git a/dup.md b/dup.md\n--- a/dup.md\n+++ b/dup.md\n@@ -1,1 +1,1 @@\n-old\n+new`,
      `diff --git a/dup.md b/dup.md\n--- a/dup.md\n+++ b/dup.md\n@@ -1,1 +1,1 @@\n-old\n+new`,
    ].join('\n')

    const created: ReviewParams[] = []
    await run({
      octokit: createMockOctokit({
        createReview: async (params) => {
          created.push(params)
          return { data: { id: 1 } }
        },
      }),
      owner: 'test',
      repo: 'test',
      pull_number: 1,
      commit_id: 'abc123',
      diff,
      event: 'COMMENT',
      body: 'Review',
    })

    assert.strictEqual(created.length, 1)
    assert.strictEqual(created[0].comments.length, 1)
  })
})
