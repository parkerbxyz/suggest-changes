import assert from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments, getGitDiff } from '../src/index.ts'

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
 * Apply a suggestion to file content
 * @param {string} content - The original file content
 * @param {import('../index.js').ReviewCommentDraft} suggestion - The suggestion to apply
 * @returns {string} The content with the suggestion applied
 */
function applySuggestion(content, suggestion) {
  const lines = content.split('\n')

  // Extract the suggestion body content (remove the ````suggestion wrapper)
  // Use greedy match (not *?) because the suggestion body always includes a newline before the closing ````
  const suggestionMatch = suggestion.body.match(/^````suggestion\n([\s\S]*)\n````$/)
  if (!suggestionMatch) {
    throw new Error(
      `Invalid suggestion body format. Expected format: \`\`\`\`suggestion\\n<content>\\n\`\`\`\`\n` +
      `Received: ${suggestion.body}`
    )
  }
  const suggestionContent = suggestionMatch[1]
  const suggestionLines = suggestionContent === '' ? [] : suggestionContent.split('\n')

  // Determine which lines to replace
  // GitHub suggestions use 1-based line numbers
  const startLine = suggestion.start_line ?? suggestion.line
  const endLine = suggestion.line

  // Convert to 0-based array indices
  const startIndex = startLine - 1
  const endIndex = endLine - 1

  // Replace the lines
  const newLines = [
    ...lines.slice(0, startIndex),
    ...suggestionLines,
    ...lines.slice(endIndex + 1)
  ]

  return newLines.join('\n')
}

/**
 * Apply multiple suggestions to file content in the correct order
 * Suggestions must be applied in reverse order (bottom to top) to avoid line number shifts
 * @param {string} content - The original file content
 * @param {Array<import('../index.js').ReviewCommentDraft>} suggestions - The suggestions to apply
 * @returns {string} The content with all suggestions applied
 */
function applySuggestions(content, suggestions) {
  // Sort suggestions by line number in descending order (bottom to top)
  // This ensures that applying one suggestion doesn't shift line numbers for others
  const sortedSuggestions = [...suggestions].sort((a, b) => {
    const aStart = a.start_line ?? a.line
    const bStart = b.start_line ?? b.line
    return bStart - aStart
  })

  let result = content
  for (const suggestion of sortedSuggestions) {
    result = applySuggestion(result, suggestion)
  }
  return result
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
          const parsed = parseGitDiff(diffContent)
          // For clarity in snapshots we want the path to reference the BEFORE file.
          // The diff we generate is from before -> after (so parseGitDiff reports the "after" path),
          // but suggestions conceptually apply to the before state to reach the after state in these fixtures.
          const suggestions = generateReviewComments(parsed).map((s) => ({
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
          const parsed = parseGitDiff(diffContent)
          const suggestions = generateReviewComments(parsed)

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
})
