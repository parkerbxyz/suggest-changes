// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import { RequestError } from '@octokit/request-error'
import {
  createLimitedReviewBody,
  limitCommentsForReview,
  run,
} from '../index.js'

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

/**
 * @param {{existingComments?: Array<{path: string, line?: number, start_line?: number, body: string}>, createReview?: (params: any) => Promise<any>}} [options]
 */
function createMockOctokit({ existingComments = [], createReview } = {}) {
  return {
    pulls: {
      listReviewComments: async () => ({ data: existingComments }),
      createReview:
        createReview ??
        (async () => ({
          data: { id: 1 },
        })),
    },
  }
}

describe('review comment limit', () => {
  test('limits review comments to the first 100 suggestions', () => {
    const comments = createMockFiles(150).map((file) => ({
      ...file,
      line: 1,
      body: 'suggestion',
    }))

    const result = limitCommentsForReview(comments)

    assert.strictEqual(result.comments.length, 100)
    assert.strictEqual(result.omittedCount, 50)
    assert.strictEqual(result.comments[0].path, 'file0.md')
    assert.strictEqual(result.comments[99].path, 'file99.md')
  })

  test('adds omitted suggestion details to the review body when capped', () => {
    assert.strictEqual(
      createLimitedReviewBody('Please fix these issues', 100, 100),
      'Please fix these issues'
    )

    const result = createLimitedReviewBody('Please fix these issues', 100, 150)

    assert.ok(result.includes('Please fix these issues'))
    assert.ok(result.includes('Posted 100 of 150 suggestions'))
    assert.ok(result.includes('50 additional suggestions remain'))
    assert.ok(result.includes('future workflow runs'))
  })

  test('creates one review capped at 100 comments', async () => {
    const files = createMockFiles(150)
    const createdReviews = []

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
    const firstRunReviews = []

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

    const secondRunReviews = []
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

  test('returns no posted comments when GitHub API rate-limits review creation', async () => {
    const error = new RequestError('API rate limit exceeded', 429, {
      response: {
        url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
        status: 429,
        headers: {
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        data: {},
      },
      request: {
        method: 'POST',
        url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
        headers: {},
      },
    })

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
})
