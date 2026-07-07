import assert from 'node:assert'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import {
  createSuggestion,
  generateCommentKey,
  generateReviewComments,
  run,
  sortCommentsForBatch,
} from '../src/index.ts'
import { makeDiff } from './helpers.ts'

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

  describe('sortCommentsForBatch', () => {
    test('should order multi-line suggestions by end line before start line', () => {
      const sorted = sortCommentsForBatch([
        {
          path: 'file.md',
          line: 90,
          body: 'single-line suggestion',
        },
        {
          path: 'file.md',
          line: 100,
          start_line: 1,
          body: 'multi-line suggestion',
        },
      ])

      assert.deepStrictEqual(
        sorted.map((comment) => comment.body),
        ['multi-line suggestion', 'single-line suggestion']
      )
    })
  })

  describe('run', () => {
    test('should return no comments for empty diff', async () => {
      const mockOctokit = {
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
        },
      }

      const result = await run({
        // @ts-expect-error - Test mock doesn't need full Octokit interface
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
        suggestionsRemaining: 0,
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
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const result = await run({
        // @ts-expect-error - Test mock doesn't need full Octokit interface
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
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const validEvents = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const

      for (const event of validEvents) {
        const result = await run({
          // @ts-expect-error - Test mock doesn't need full Octokit interface
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

    test('should keep suggestions for renamed files in the pull request diff', async () => {
      // The canonical PR diff reports a renamed-and-edited file as a rename;
      // its suggestions must anchor under the new path instead of being
      // filtered out as outside the diff.
      const localDiff = makeDiff(
        ['@@ -1,1 +1,1 @@', '-old line', '+new line'],
        'new.md'
      )
      const pullRequestDiff = [
        'diff --git a/old.md b/new.md',
        'similarity index 90%',
        'rename from old.md',
        'rename to new.md',
        'index 0000001..0000002 100644',
        '--- a/old.md',
        '+++ b/new.md',
        '@@ -1,1 +1,1 @@',
        '-old line',
        '+new line',
        '',
      ].join('\n')

      const mockOctokit = {
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          get: async () => ({ data: pullRequestDiff }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const result = await run({
        // @ts-expect-error - Test mock doesn't need full Octokit interface
        octokit: mockOctokit,
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 1,
        commit_id: 'abc123',
        diff: localDiff,
        event: 'COMMENT',
        body: '',
      })

      assert.strictEqual(result.reviewCreated, true)
      assert.strictEqual(result.comments.length, 1)
      assert.strictEqual(result.comments[0].path, 'new.md')
    })

    test('should drop suggestions whose range crosses lines outside the pull request diff', async () => {
      // The suggestion spans lines 2-5; the PR diff contains lines 1-2 and
      // 5-6 but not the interior lines 3-4, so the whole range is invalid
      // even though both endpoints are anchorable.
      const localDiff = makeDiff(
        [
          '@@ -1,6 +1,2 @@',
          ' line one',
          '-line two',
          '-line three',
          '-line four',
          '-line five',
          ' line six',
        ],
        'file.md'
      )
      const pullRequestDiff = [
        'diff --git a/file.md b/file.md',
        'index 0000001..0000002 100644',
        '--- a/file.md',
        '+++ b/file.md',
        '@@ -1,2 +1,2 @@',
        ' line one',
        '-x',
        '+y',
        '@@ -5,2 +5,2 @@',
        ' ctx five',
        '-a',
        '+b',
        '',
      ].join('\n')

      const mockOctokit = {
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          get: async () => ({ data: pullRequestDiff }),
          createReview: async () => {
            throw new Error('createReview must not be called')
          },
        },
      }

      const result = await run({
        // @ts-expect-error - Test mock doesn't need full Octokit interface
        octokit: mockOctokit,
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 1,
        commit_id: 'abc123',
        diff: localDiff,
        event: 'COMMENT',
        body: '',
      })

      assert.strictEqual(result.reviewCreated, false)
      assert.deepStrictEqual(result.comments, [])
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
