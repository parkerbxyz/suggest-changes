// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../index.js'

describe('Newline handling fix', () => {
  test('should suggest replacing 1 line with 2 lines (codestyle fix scenario)', () => {
    // This is the scenario where a codestyle checker expands 1 malformed line into 2 proper lines
    const diff = `diff --git a/api/components/com_banners/src/Controller/BannersController.php b/api/components/com_banners/src/Controller/BannersController.php
index 2f85d10280144..4fb7c9d5fbfae 100644
--- a/api/components/com_banners/src/Controller/BannersController.php
+++ b/api/components/com_banners/src/Controller/BannersController.php
@@ -21,7 +21,8 @@
  *
  * @since  4.0.0
  */
-class BannersController extends ApiController                                          {
+class BannersController extends ApiController
+{
     /**
      * The content type of the item.
      *`

    const parsedDiff = parseGitDiff(diff)
    const suggestions = generateReviewComments(parsedDiff)

    assert.strictEqual(suggestions.length, 1, 'Should generate exactly one suggestion')
    
    const suggestion = suggestions[0]
    assert.strictEqual(suggestion.path, 'api/components/com_banners/src/Controller/BannersController.php')
    assert.strictEqual(suggestion.line, 24, 'Should target line 24')
    assert.strictEqual(suggestion.start_line, undefined, 'Should be single line replacement (no start_line)')
    assert.strictEqual(
      suggestion.body, 
      '````suggestion\nclass BannersController extends ApiController\n{\n````',
      'Should suggest the properly formatted code'
    )
  })

  test('should suggest replacing 2 lines with 1 line (reverse scenario)', () => {
    // This is the reverse scenario where 2 proper lines get collapsed into 1 malformed line
    const diff = `diff --git a/api/components/com_banners/src/Controller/BannersController.php b/api/components/com_banners/src/Controller/BannersController.php
index 4fb7c9d5fbfae..2f85d10280144 100644
--- a/api/components/com_banners/src/Controller/BannersController.php
+++ b/api/components/com_banners/src/Controller/BannersController.php
@@ -21,8 +21,7 @@
  *
  * @since  4.0.0
  */
-class BannersController extends ApiController
-{
+class BannersController extends ApiController                                          {
     /**
      * The content type of the item.
      *`

    const parsedDiff = parseGitDiff(diff)
    const suggestions = generateReviewComments(parsedDiff)

    assert.strictEqual(suggestions.length, 1, 'Should generate exactly one suggestion')
    
    const suggestion = suggestions[0]
    assert.strictEqual(suggestion.path, 'api/components/com_banners/src/Controller/BannersController.php')
    assert.strictEqual(suggestion.line, 25, 'Should target line 25')
    assert.strictEqual(suggestion.start_line, 24, 'Should start at line 24 (multi-line replacement)')
    assert.strictEqual(
      suggestion.body, 
      '````suggestion\nclass BannersController extends ApiController                                          {\n````',
      'Should suggest the collapsed (malformed) code as per the diff'
    )
    
    // Key assertion: should replace 2 lines (deletedLines.length) even though only 1 line is added
    const linesBeingReplaced = (suggestion.line - suggestion.start_line) + 1
    assert.strictEqual(linesBeingReplaced, 2, 'Should replace exactly 2 lines based on deleted lines count')
  })

  test('should handle equal line replacement correctly', () => {
    // Scenario where deleted lines equal added lines
    const diff = `diff --git a/test.php b/test.php
index abc123..def456 100644
--- a/test.php
+++ b/test.php
@@ -1,3 +1,3 @@
  // unchanged
-old line 1
-old line 2
+new line 1
+new line 2
  // unchanged`

    const parsedDiff = parseGitDiff(diff)
    const suggestions = generateReviewComments(parsedDiff)

    assert.strictEqual(suggestions.length, 1, 'Should generate exactly one suggestion')
    
    const suggestion = suggestions[0]
    assert.strictEqual(suggestion.line, 3, 'Should target line 3')
    assert.strictEqual(suggestion.start_line, 2, 'Should start at line 2')
    
    const linesBeingReplaced = (suggestion.line - suggestion.start_line) + 1
    assert.strictEqual(linesBeingReplaced, 2, 'Should replace exactly 2 lines (same as deleted count)')
  })

  test('should handle more deletions than additions (edge case)', () => {
    // Edge case: 3 deleted lines, 1 added line
    const diff = `diff --git a/test.php b/test.php
index abc123..def456 100644
--- a/test.php
+++ b/test.php
@@ -1,6 +1,4 @@
  // unchanged
-line 1 to delete
-line 2 to delete  
-line 3 to delete
+single replacement line
  // unchanged`

    const parsedDiff = parseGitDiff(diff)
    const suggestions = generateReviewComments(parsedDiff)

    assert.strictEqual(suggestions.length, 1, 'Should generate exactly one suggestion')
    
    const suggestion = suggestions[0]
    assert.strictEqual(suggestion.line, 4, 'Should target line 4')
    assert.strictEqual(suggestion.start_line, 2, 'Should start at line 2')
    assert.strictEqual(
      suggestion.body, 
      '````suggestion\nsingle replacement line\n````',
      'Should suggest the single replacement line'
    )
    
    // Key assertion: should replace 3 lines (deletedLines.length) even though only 1 line is added
    const linesBeingReplaced = (suggestion.line - suggestion.start_line) + 1
    assert.strictEqual(linesBeingReplaced, 3, 'Should replace exactly 3 lines based on deleted lines count')
  })
})
