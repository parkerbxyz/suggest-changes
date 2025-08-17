// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../index.js'

describe('Range validation logging', () => {
  test('should log message when suggestions would be out of valid line range', () => {
    // Create a scenario that results in out-of-range line positions
    // Pure additions with zero-line fromFileRange create this situation
    const diff = `diff --git a/test.txt b/test.txt  
--- a/test.txt
+++ b/test.txt
@@ -3,0 +3,2 @@
+new line 1
+new line 2`

    const parsedDiff = parseGitDiff(diff)
    
    // This should skip the suggestion due to invalid range
    const result = generateReviewComments(parsedDiff, new Set())
    
    // The suggestion should be skipped, so we get no comments
    assert.strictEqual(result.length, 0, 'Should skip suggestion due to out-of-range line positions')
  })
  
  test('should handle valid ranges correctly', () => {
    // Test with a normal diff that has valid line ranges
    const diff = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1,1 +1,1 @@
-old content
+new content`

    const parsedDiff = parseGitDiff(diff)
    
    // For this simple diff, the suggestion should be valid
    const result = generateReviewComments(parsedDiff, new Set())
    assert.strictEqual(result.length, 1, 'Should generate comment for valid line range')
    
    // Verify the comment has valid line positions
    const comment = result[0]
    assert.strictEqual(comment.line, 1, 'Should target line 1')
    assert.strictEqual(comment.path, 'test.txt')
  })
  
  test('should handle edge case where multiple line changes span boundaries', () => {
    // Test a more complex scenario with multiple changes
    const diff = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -5,5 +5,6 @@ context line
 line 4
 line 5
-old line 6
-old line 7  
+new line 6
+new line 7
+extra line
 line 8`

    const parsedDiff = parseGitDiff(diff)
    const result = generateReviewComments(parsedDiff, new Set())
    
    // All suggestions should be valid in this case too
    assert.ok(result.length > 0, 'Should generate suggestions')
    result.forEach(comment => {
      assert.ok(comment.line > 0, 'Comment line should be positive')
      assert.strictEqual(comment.path, 'test.txt')
    })
  })
})