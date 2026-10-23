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
import type { PullRequestFilePatch } from '../src/types.ts'
import { makeDiff, makePullRequestFile } from './helpers.ts'

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
        pullRequestFiles: [],
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
        pullRequestFiles: [
          makePullRequestFile(
            ['@@ -1,1 +1,1 @@', '-old line', '+new line'],
            'test.md'
          ),
        ],
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
          pullRequestFiles: [
            makePullRequestFile(
              ['@@ -1,1 +1,1 @@', '-old', '+new'],
              'test.md'
            ),
          ],
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
      // The files endpoint reports the new filename, which must match the
      // suggestion path after a rename.
      const localDiff = makeDiff(
        ['@@ -1,1 +1,1 @@', '-old line', '+new line'],
        'new.md'
      )
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
        diff: localDiff,
        pullRequestFiles: [
          makePullRequestFile(
            ['@@ -1,1 +1,1 @@', '-old line', '+new line'],
            'new.md'
          ),
        ],
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
      const pullRequestPatch = [
        '@@ -1,2 +1,2 @@',
        ' line one',
        '-x',
        '+y',
        '@@ -5,2 +5,2 @@',
        ' ctx five',
        '-a',
        '+b',
      ]

      const mockOctokit = {
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
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
        pullRequestFiles: [
          makePullRequestFile(pullRequestPatch, 'file.md'),
        ],
        event: 'COMMENT',
        body: '',
      })

      assert.strictEqual(result.reviewCreated, false)
      assert.deepStrictEqual(result.comments, [])
    })

    test('should keep suggestions for files beyond the raw diff file limit', async () => {
      const targetPath = 'file300.md'
      const hunk = ['@@ -1,1 +1,1 @@', '-old line', '+new line']
      const pullRequestFiles = Array.from({ length: 301 }, (_, index) =>
        index === 300
          ? makePullRequestFile(hunk, targetPath)
          : makePullRequestFile([], `file${index}.md`)
      )
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
        diff: makeDiff(hunk, targetPath),
        pullRequestFiles,
        event: 'COMMENT',
        body: '',
      })

      assert.strictEqual(result.reviewCreated, true)
      assert.strictEqual(result.comments.length, 1)
      assert.strictEqual(result.comments[0].path, targetPath)
    })

    test('should retain suggestions when a file patch is unavailable or incomplete', async () => {
      const hunk = ['@@ -1,1 +1,1 @@', '-old line', '+new line']
      const mockOctokit = {
        paginate: async () => [],
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          createReview: async () => ({ data: { id: 123 } }),
        },
      }

      const unverifiedFiles: PullRequestFilePatch[][] = [
        [{ filename: 'file.md', additions: 1, deletions: 1 }],
        [
          {
            filename: 'file.md',
            patch: ['@@ -1,2 +1,2 @@', '-old line', '+new line'].join(
              '\n'
            ),
            additions: 1,
            deletions: 1,
          },
        ],
      ]
      for (const pullRequestFiles of unverifiedFiles) {
        const result = await run({
          // @ts-expect-error - Test mock doesn't need full Octokit interface
          octokit: mockOctokit,
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 1,
          commit_id: 'abc123',
          diff: makeDiff(hunk),
          pullRequestFiles,
          event: 'COMMENT',
          body: '',
        })

        assert.strictEqual(result.reviewCreated, true)
        assert.strictEqual(result.comments.length, 1)
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
