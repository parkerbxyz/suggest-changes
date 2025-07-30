// @ts-check
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments, getGitDiff } from '../index.js'

const fixtureDir = 'test/fixtures'

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
          const parsed = parseGitDiff(diffContent)
          const suggestions = generateReviewComments(parsed)
          t.assert.snapshot(suggestions)
        })
      })
  })
})
