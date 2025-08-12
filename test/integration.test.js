// @ts-check
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { strict as assert } from 'node:assert'
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments, getGitDiff } from '../index.js'

const fixtureDir = 'test/fixtures'

/**
 * Custom snapshot testing helper for Node.js test runner
 * @param {any} actual - The actual value to test
 * @param {string} testName - The test name for the snapshot
 * @returns {void}
 */
function assertSnapshot(actual, testName) {
  const snapshotFile = 'test/integration.test.js.snapshot'
  const shouldUpdateSnapshots = process.env.UPDATE_SNAPSHOTS === '1'
  let snapshots = {}
  let snapshotContent = ''
  
  try {
    // Read existing snapshot file if it exists
    snapshotContent = readFileSync(snapshotFile, 'utf8')
    // Parse the snapshot exports using a more robust approach
    const lines = snapshotContent.split('\n')
    let currentKey = null
    let currentValue = []
    let inValue = false
    
    for (const line of lines) {
      const exportMatch = line.match(/^exports\[`(.+?)`\] = `$/)
      if (exportMatch) {
        // Start of a new snapshot
        if (currentKey && currentValue.length > 0) {
          snapshots[currentKey] = currentValue.join('\n')
        }
        currentKey = exportMatch[1]
        currentValue = []
        inValue = true
      } else if (line === '`;' && inValue) {
        // End of current snapshot
        if (currentKey) {
          snapshots[currentKey] = currentValue.join('\n')
        }
        currentKey = null
        currentValue = []
        inValue = false
      } else if (inValue && currentKey) {
        // Content line
        currentValue.push(line)
      }
    }
  } catch (error) {
    // Snapshot file doesn't exist or is invalid, which is fine for new tests
    if (!shouldUpdateSnapshots) {
      console.log(`Could not read snapshot file: ${error.message}`)
    }
  }
  
  const snapshotKey = `Integration Tests > Suggestion Generation > ${testName} suggestions should match snapshot 1`
  const actualString = JSON.stringify(actual, null, 2)
  
  if (shouldUpdateSnapshots) {
    // Update or add the snapshot
    snapshots[snapshotKey] = actualString
    
    // Write updated snapshots back to file
    const updatedContent = Object.entries(snapshots)
      .map(([key, value]) => `exports[\`${key}\`] = \`\n${value}\n\`;`)
      .join('\n\n') + '\n'
    
    writeFileSync(snapshotFile, updatedContent, 'utf8')
    console.log(`Updated snapshot for ${testName}`)
    return
  }
  
  if (snapshots[snapshotKey]) {
    const expectedString = snapshots[snapshotKey]
    assert.equal(actualString, expectedString, `Snapshot mismatch for ${testName}`)
  } else {
    // For new snapshots, we'll just log what would be generated
    console.log(`Missing snapshot for ${testName}:`)
    console.log(`exports[\`${snapshotKey}\`] = \``)
    console.log(actualString)
    console.log('\`;')
    console.log('')
    throw new Error(`Snapshot missing for ${testName}. Add the above to the snapshot file or run with UPDATE_SNAPSHOTS=1.`)
  }
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
          const parsed = parseGitDiff(diffContent)
          const suggestions = generateReviewComments(parsed)
          assertSnapshot(suggestions, `${toolDir}/${testName}`)
        })
      })
  })
})
