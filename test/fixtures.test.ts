import assert from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { getGitDiff, sortCommentsForBatch } from '../src/index.ts'
import { applySuggestion, applySuggestions, suggestionsFor } from './helpers.ts'

const fixtureDir = 'test/fixtures'

/**
 * Normalize line endings to LF for cross-platform consistency
 * @param {string} content - File content to normalize
 * @returns {string} Content with normalized line endings
 */
function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, '\n')
}

/**
 * Generate a git diff between two files using the same logic as index.js
 * @param {string} beforeFile - Path to the "before" file
 * @param {string} afterFile - Path to the "after" file
 * @returns {Promise<string>} The git diff output
 */
async function generateDiff(beforeFile, afterFile) {
  // Use the shared git diff function with --no-index for comparing files outside git context
  return await getGitDiff(['--no-index', beforeFile, afterFile])
}

/**
 * Find before/after file pairs in a directory
 * @param {string} dirPath - Directory to search
 * @returns {Array<{beforeFile: string, afterFile: string, testName: string}>}
 */
function findBeforeAfterPairs(dirPath) {
  const files = readdirSync(dirPath)

  return files
    .filter((file) => file.startsWith('before.') || file.includes('-before.'))
    .flatMap((beforeFile) => {
      const afterFile = beforeFile.replace(/before(\.|-)/, 'after$1')

      if (!files.includes(afterFile)) {
        return []
      }

      // Extract test name: "complex-before.md" → "complex", "before.md" → "default"
      const testName = beforeFile.match(/^(.+)-before\./)?.[1] || 'default'

      return [
        {
          beforeFile: join(dirPath, beforeFile),
          afterFile: join(dirPath, afterFile),
          testName,
        },
      ]
    })
}

describe('Integration Tests', () => {
  // Discover all tool directories and their test pairs
  const toolDirs = readdirSync(fixtureDir).filter((item) => {
    try {
      return statSync(join(fixtureDir, item)).isDirectory()
    } catch {
      return false
    }
  })

  describe('Suggestion Generation', () => {
    // Generate tests for all tool/testcase combinations
    toolDirs
      .flatMap((toolDir) =>
        findBeforeAfterPairs(join(fixtureDir, toolDir)).map((pair) => ({
          toolDir,
          ...pair,
        }))
      )
      .forEach(({ toolDir, beforeFile, afterFile, testName }) => {
        test(`${toolDir}/${testName} suggestions should match snapshot`, async (t) => {
          const diffContent = await generateDiff(beforeFile, afterFile)
          // For clarity in snapshots we want the path to reference the BEFORE file.
          // The diff we generate is from before -> after (so the parsed diff reports the "after" path),
          // but suggestions conceptually apply to the before state to reach the after state in these fixtures.
          const suggestions = suggestionsFor(diffContent).map((s) => ({
            ...s,
            path: beforeFile,
          }))
          t.assert.snapshot(suggestions)
        })
      })
  })

  describe('Suggestion Application', () => {
    // Generate tests for all tool/testcase combinations
    // These tests verify that applying the generated suggestions to the "before" state
    // produces the "after" state, ensuring the suggestions are correct and complete.
    toolDirs
      .flatMap((toolDir) =>
        findBeforeAfterPairs(join(fixtureDir, toolDir)).map((pair) => ({
          toolDir,
          ...pair,
        }))
      )
      .forEach(({ toolDir, beforeFile, afterFile, testName }) => {
        test(`${toolDir}/${testName} applying suggestions should transform before → after`, async () => {
          // Read the before and after files with normalized line endings
          const beforeContent = normalizeLineEndings(readFileSync(beforeFile, 'utf8'))
          const afterContent = normalizeLineEndings(readFileSync(afterFile, 'utf8'))

          // Generate suggestions
          const diffContent = await generateDiff(beforeFile, afterFile)
          const suggestions = suggestionsFor(diffContent)

          // Apply suggestions to the before content
          const result = applySuggestions(beforeContent, suggestions)

          // Verify that applying suggestions transforms before → after
          assert.strictEqual(
            result,
            afterContent,
            `Applying suggestions should transform ${beforeFile} to match ${afterFile}`
          )
        })
      })
  })

  describe('Batch safety', () => {
    test('new-file-issue suggestions should apply safely in review batch order', async () => {
      const beforeFile = 'test/fixtures/new-file-issue/before.md'
      const afterFile = 'test/fixtures/new-file-issue/after.md'
      const beforeContent = normalizeLineEndings(readFileSync(beforeFile, 'utf8'))
      const afterContent = normalizeLineEndings(readFileSync(afterFile, 'utf8'))
      const diffContent = await generateDiff(beforeFile, afterFile)
      const suggestions = sortCommentsForBatch(suggestionsFor(diffContent))

      // Apply in the generated (batch) order, without re-sorting
      const result = suggestions.reduce(applySuggestion, beforeContent)

      assert.strictEqual(result, afterContent)
    })
  })
})
