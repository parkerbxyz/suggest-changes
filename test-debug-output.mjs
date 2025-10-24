// @ts-check
import { generateReviewComments } from './index.js'
import parseGitDiff from 'parse-git-diff'

// Capture debug output
const debugMessages = []
const originalDebug = console.log

// Mock the debug function from @actions/core
import * as core from '@actions/core'
const originalCoreDebug = core.debug
const mockDebug = (message) => {
  debugMessages.push(message)
  originalDebug(message)
}
core.debug = mockDebug

const diff = `diff --git a/test.md b/test.md
--- a/test.md
+++ b/test.md
@@ -1,1 +1,1 @@
-old line
+new line`

const parsedDiff = parseGitDiff(diff)

// First call - should generate a comment and log detailed debug
originalDebug('\n=== First run (no existing comments) ===')

const firstResult = generateReviewComments(parsedDiff, new Set())

// Create existing comment keys from first result
const existingKeys = new Set(
  firstResult.map(
    (comment) =>
      `${comment.path}:${comment.line ?? ''}:${comment.start_line ?? ''}:${comment.body}`
  )
)

// Clear debug messages to focus on second run
debugMessages.length = 0

// Second call with duplicate - should skip and STILL show detailed debug
originalDebug('\n=== Second run (with existing comments - should show detailed debug for skipped) ===')

const secondResult = generateReviewComments(parsedDiff, existingKeys)

originalDebug('\n=== Results ===')
originalDebug(`First run returned ${firstResult.length} comments`)
originalDebug(`Second run returned ${secondResult.length} comments (skipped as duplicates)`)
originalDebug('\n=== Verification ===')

// Check if detailed debug output was present in second run
const hasGeneratedSuggestions = debugMessages.some(msg => msg.includes('Generated suggestions: 1'))
const hasDraftReviewComment = debugMessages.some(msg => msg.includes('- Draft review comment:'))
const hasPath = debugMessages.some(msg => msg.includes('path: test.md'))
const hasLine = debugMessages.some(msg => msg.includes('line: 1'))
const hasBody = debugMessages.some(msg => msg.includes('body:'))

originalDebug(`✓ Has "Generated suggestions: 1": ${hasGeneratedSuggestions}`)
originalDebug(`✓ Has "- Draft review comment:": ${hasDraftReviewComment}`)
originalDebug(`✓ Has "path: test.md": ${hasPath}`)
originalDebug(`✓ Has "line: 1": ${hasLine}`)
originalDebug(`✓ Has "body:": ${hasBody}`)

if (hasGeneratedSuggestions && hasDraftReviewComment && hasPath && hasLine && hasBody) {
  originalDebug('\n✅ SUCCESS: Detailed debug output is now present for skipped suggestions!')
  process.exit(0)
} else {
  originalDebug('\n❌ FAIL: Detailed debug output missing for skipped suggestions')
  originalDebug('\nDebug messages captured:')
  debugMessages.forEach(msg => originalDebug(`  ${msg}`))
  process.exit(1)
}
