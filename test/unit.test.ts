import assert from 'node:assert'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import {
  createSuggestion,
  generateCommentKey,
  generateReviewComments,
  run,
} from '../src/index.ts'

describe('Unit Tests', () => {
  describe('generateCommentKey', () => {
    test('should generate unique keys for different comments', () => {
      const comment1 = {
        path: 'file.md',
        line: 5,
        start_line: 3,
        body: 'Fix this',
      }

      const comment2 = {
        path: 'file.md',
        line: 5,
        start_line: 3,
        body: 'Fix that',
      }

      const key1 = generateCommentKey(comment1)
      const key2 = generateCommentKey(comment2)

      assert.notStrictEqual(
        key1,
        key2,
        'Different comments should have different keys'
      )
      assert.strictEqual(key1, 'file.md:5:3:Fix this')
      assert.strictEqual(key2, 'file.md:5:3:Fix that')
    })

    test('should handle missing optional fields', () => {
      const comment = {
        path: 'file.md',
        body: 'Simple comment',
      }

      const key = generateCommentKey(comment)
      assert.strictEqual(key, 'file.md:::Simple comment')
    })

    test('should generate same key for identical comments', () => {
      const comment1 = {
        path: 'test.md',
        line: 2,
        start_line: 1,
        body: '````suggestion\n### Level 3 heading\nThis is a sentence.\n````',
      }

      const comment2 = {
        path: 'test.md',
        line: 2,
        start_line: 1,
        body: '````suggestion\n### Level 3 heading\nThis is a sentence.\n````',
      }

      const key1 = generateCommentKey(comment1)
      const key2 = generateCommentKey(comment2)

      assert.strictEqual(
        key1,
        key2,
        'Identical comments should have the same key'
      )
    })
  })

  describe('createSuggestion', () => {
    test('should format single line suggestion', () => {
      const result = createSuggestion('Fix trailing space')
      assert.strictEqual(result, '````suggestion\nFix trailing space\n````')
    })

    test('should format multi-line suggestion', () => {
      const result = createSuggestion('Line 1\nLine 2')
      assert.strictEqual(result, '````suggestion\nLine 1\nLine 2\n````')
    })

    test('should handle empty content', () => {
      const result = createSuggestion('')
      assert.strictEqual(result, '````suggestion\n\n````')
    })

    test('should preserve whitespace and formatting', () => {
      const result = createSuggestion('  Indented line  \n\nWith empty line')
      assert.strictEqual(
        result,
        '````suggestion\n  Indented line  \n\nWith empty line\n````'
      )
    })
  })

  describe('run', () => {
    test('should return no comments for empty diff', async () => {
      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
        },
      }

      const result = await run({
        // @ts-ignore - Test mock doesn't need full Octokit interface
        octokit: mockOctokit,
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 1,
        commit_id: 'abc123',
        diff: '',
        event: 'COMMENT',
        body: 'Test review',
      })

      assert.deepStrictEqual(result, {
        comments: [],
        reviewCreated: false,
      })
    })

    test('should create review when diff generates comments', async () => {
      const diff = `diff --git a/test.md b/test.md
--- a/test.md
+++ b/test.md
@@ -1,1 +1,1 @@
-old line
+new line`

      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const result = await run({
        // @ts-ignore - Test mock doesn't need full Octokit interface
        octokit: mockOctokit,
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 1,
        commit_id: 'abc123',
        diff,
        event: 'COMMENT',
        body: 'Test review',
      })

      assert.strictEqual(result.reviewCreated, true)
      assert.strictEqual(result.comments.length, 1)
    })

    test('should accept valid event types', async () => {
      const mockOctokit = {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const validEvents = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const

      for (const event of validEvents) {
        const result = await run({
          // @ts-ignore - Test mock doesn't need full Octokit interface
          octokit: mockOctokit,
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 1,
          commit_id: 'abc123',
          diff: 'diff --git a/test.md b/test.md\n--- a/test.md\n+++ b/test.md\n@@ -1,1 +1,1 @@\n-old\n+new',
          event,
          body: '',
        })

        assert.ok(
          result.reviewCreated || result.comments.length === 0,
          `Should accept valid event type: ${event}`
        )
      }
    })
  })

  describe('generateReviewComments', () => {
    test('should log message when skipping duplicate suggestions', () => {
      const diff = `diff --git a/test.md b/test.md
--- a/test.md
+++ b/test.md
@@ -1,1 +1,1 @@
-old line
+new line`

      const parsedDiff = parseGitDiff(diff)

      // First call should generate a comment
      const firstResult = generateReviewComments(parsedDiff, new Set())
      assert.strictEqual(
        firstResult.length,
        1,
        'Should generate one comment on first call'
      )

      // Create existing comment keys based on the first result
      const existingCommentKeys = new Set(
        firstResult.map(
          (comment) =>
            `${comment.path}:${comment.line ?? ''}:${
              comment.start_line ?? ''
            }:${comment.body}`
        )
      )

      // Second call with same diff should skip duplicate and return no comments
      const secondResult = generateReviewComments(
        parsedDiff,
        existingCommentKeys
      )
      assert.strictEqual(
        secondResult.length,
        0,
        'Should skip duplicate comment on second call'
      )
    })
  })
})
