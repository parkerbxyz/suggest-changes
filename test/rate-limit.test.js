// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import { RequestError } from '@octokit/request-error'
import { batchComments, createBatchReviewBody, run } from '../index.js'

describe('Rate Limit Handling', () => {
  describe('batchComments', () => {
    test('should return single batch when comments <= 100', () => {
      const comments = Array.from({ length: 50 }, (_, i) => ({
        path: `file${i}.md`,
        line: 1,
        body: `suggestion ${i}`,
      }))

      const batches = batchComments(comments)
      assert.strictEqual(batches.length, 1)
      assert.strictEqual(batches[0].length, 50)
    })

    test('should split into multiple batches when comments > 100', () => {
      const comments = Array.from({ length: 250 }, (_, i) => ({
        path: `file${i}.md`,
        line: 1,
        body: `suggestion ${i}`,
      }))

      const batches = batchComments(comments)
      assert.strictEqual(batches.length, 3)
      assert.strictEqual(batches[0].length, 100)
      assert.strictEqual(batches[1].length, 100)
      assert.strictEqual(batches[2].length, 50)
    })

    test('should handle exactly 100 comments', () => {
      const comments = Array.from({ length: 100 }, (_, i) => ({
        path: `file${i}.md`,
        line: 1,
        body: `suggestion ${i}`,
      }))

      const batches = batchComments(comments)
      assert.strictEqual(batches.length, 1)
      assert.strictEqual(batches[0].length, 100)
    })

    test('should handle exactly 101 comments', () => {
      const comments = Array.from({ length: 101 }, (_, i) => ({
        path: `file${i}.md`,
        line: 1,
        body: `suggestion ${i}`,
      }))

      const batches = batchComments(comments)
      assert.strictEqual(batches.length, 2)
      assert.strictEqual(batches[0].length, 100)
      assert.strictEqual(batches[1].length, 1)
    })

    test('should handle empty comments array', () => {
      const batches = batchComments([])
      assert.strictEqual(batches.length, 0)
    })

    test('should support custom batch size', () => {
      const comments = Array.from({ length: 30 }, (_, i) => ({
        path: `file${i}.md`,
        line: 1,
        body: `suggestion ${i}`,
      }))

      const batches = batchComments(comments, 10)
      assert.strictEqual(batches.length, 3)
      assert.strictEqual(batches[0].length, 10)
      assert.strictEqual(batches[1].length, 10)
      assert.strictEqual(batches[2].length, 10)
    })
  })

  describe('createBatchReviewBody', () => {
    test('should return original body for single batch', () => {
      const body = 'Please fix these issues'
      const result = createBatchReviewBody(body, 1, 1, 50)
      assert.strictEqual(result, body)
    })

    test('should add batch info for multiple batches', () => {
      const body = 'Please fix these issues'
      const result = createBatchReviewBody(body, 1, 3, 250)

      assert.ok(result.includes('Please fix these issues'))
      assert.ok(result.includes('250 suggestions'))
      assert.ok(result.includes('3 separate reviews'))
      assert.ok(result.includes('This is review 1 of 3'))
      assert.ok(result.includes('100 comments per review'))
    })

    test('should handle empty base body with multiple batches', () => {
      const result = createBatchReviewBody('', 2, 3, 250)

      assert.ok(result.includes('250 suggestions'))
      assert.ok(result.includes('3 separate reviews'))
      assert.ok(result.includes('This is review 2 of 3'))
      assert.ok(!result.startsWith('\n'))
    })

    test('should preserve original body content', () => {
      const body = 'Custom message with **markdown**'
      const result = createBatchReviewBody(body, 2, 2, 150)

      assert.ok(result.includes('Custom message with **markdown**'))
    })

    test('should include correct batch number in each review', () => {
      const body = 'Review comment'

      const batch1 = createBatchReviewBody(body, 1, 3, 250)
      assert.ok(batch1.includes('This is review 1 of 3'))

      const batch2 = createBatchReviewBody(body, 2, 3, 250)
      assert.ok(batch2.includes('This is review 2 of 3'))

      const batch3 = createBatchReviewBody(body, 3, 3, 250)
      assert.ok(batch3.includes('This is review 3 of 3'))
    })
  })

  describe('run with batching', () => {
    test('should create multiple reviews for >100 comments', async () => {
      const comments = Array.from({ length: 150 }, (_, i) => ({
        path: `file${i}.md`,
        line: i + 1,
        body: `suggestion ${i}`,
      }))

      // Create a large diff that generates many comments
      const diff = comments
        .map(
          (c, i) =>
            `diff --git a/${c.path} b/${c.path}\n--- a/${c.path}\n+++ b/${c.path}\n@@ -1,1 +1,1 @@\n-old line ${i}\n+new line ${i}`
        )
        .join('\n')

      let reviewCount = 0
      const createdReviews = []

      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listFiles: async () => ({
            data: comments.map((c) => ({ filename: c.path })),
          }),
          createReview: async (params) => {
            reviewCount++
            createdReviews.push(params)
            return { data: { id: reviewCount } }
          },
        },
      }

      const result = await run({
        octokit: mockOctokit,
        owner: 'test',
        repo: 'test',
        pull_number: 1,
        commit_id: 'abc123',
        diff,
        event: 'COMMENT',
        body: 'Please fix',
      })

      assert.strictEqual(reviewCount, 2, 'Should create 2 reviews')
      assert.strictEqual(createdReviews[0].comments.length, 100)
      assert.strictEqual(createdReviews[1].comments.length, 50)
      assert.ok(createdReviews[0].body.includes('150 suggestions'))
      assert.ok(createdReviews[0].body.includes('This is review 1 of 2'))
      assert.ok(createdReviews[1].body.includes('This is review 2 of 2'))
      assert.strictEqual(result.reviewCreated, true)
    })

    test('should handle rate limit error gracefully', async () => {
      const diff =
        'diff --git a/test.md b/test.md\n--- a/test.md\n+++ b/test.md\n@@ -1,1 +1,1 @@\n-old\n+new'

      let reviewAttempts = 0
      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listFiles: async () => ({ data: [{ filename: 'test.md' }] }),
          createReview: async () => {
            reviewAttempts++
            // Simulate rate limit error
            throw new RequestError('API rate limit exceeded', 429, {
              response: {
                url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
                status: 429,
                headers: {
                  'x-ratelimit-reset': String(
                    Math.floor(Date.now() / 1000) + 3600
                  ),
                },
                data: {},
              },
              request: {
                method: 'POST',
                url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
                headers: {},
              },
            })
          },
        },
      }

      const result = await run({
        octokit: mockOctokit,
        owner: 'test',
        repo: 'test',
        pull_number: 1,
        commit_id: 'abc123',
        diff,
        event: 'COMMENT',
        body: 'Review',
      })

      assert.strictEqual(reviewAttempts, 1, 'Should only attempt once')
      assert.strictEqual(
        result.reviewCreated,
        false,
        'Should not mark as created'
      )
      assert.strictEqual(result.comments.length, 0)
    })

    test('should continue with next batch if one batch fails with 422 error', async () => {
      const comments = Array.from({ length: 150 }, (_, i) => ({
        path: `file${i}.md`,
        line: i + 1,
        body: `suggestion ${i}`,
      }))

      const diff = comments
        .map(
          (c, i) =>
            `diff --git a/${c.path} b/${c.path}\n--- a/${c.path}\n+++ b/${c.path}\n@@ -1,1 +1,1 @@\n-old line ${i}\n+new line ${i}`
        )
        .join('\n')

      let reviewCount = 0
      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listFiles: async () => ({
            data: comments.map((c) => ({ filename: c.path })),
          }),
          createReview: async (params) => {
            reviewCount++
            // First batch fails with 422
            if (reviewCount === 1) {
              throw new RequestError(
                'Validation Failed: line must be part of the diff',
                422,
                {
                  response: {
                    url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
                    status: 422,
                    headers: {},
                    data: {},
                  },
                  request: {
                    method: 'POST',
                    url: 'https://api.github.com/repos/test/test/pulls/1/reviews',
                    headers: {},
                  },
                }
              )
            }
            return { data: { id: reviewCount } }
          },
        },
      }

      const result = await run({
        octokit: mockOctokit,
        owner: 'test',
        repo: 'test',
        pull_number: 1,
        commit_id: 'abc123',
        diff,
        event: 'COMMENT',
        body: 'Review',
      })

      assert.strictEqual(reviewCount, 2, 'Should attempt both batches')
      assert.strictEqual(
        result.reviewCreated,
        true,
        'Should mark as created when at least one succeeds'
      )
    })
  })
})
