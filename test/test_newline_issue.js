// @ts-check
import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../index.js'

// Simulate the PHP file diff that reproduces the issue
const testDiff = `diff --git a/api/components/com_banners/src/Controller/BannersController.php b/api/components/com_banners/src/Controller/BannersController.php
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

console.log('Testing diff that should suggest replacing 2 lines with 1 line:')
console.log('Input diff:')
console.log(testDiff)
console.log('\n---')

const parsedDiff = parseGitDiff(testDiff)
console.log('Parsed diff:')
console.log(JSON.stringify(parsedDiff, null, 2))
console.log('\n---')

const suggestions = generateReviewComments(parsedDiff)
console.log('Generated suggestions:')
console.log(JSON.stringify(suggestions, null, 2))

// Check if the suggestion is correct
if (suggestions.length > 0) {
  const firstSuggestion = suggestions[0]
  console.log('\n---')
  console.log('First suggestion details:')
  console.log('- start_line:', firstSuggestion.start_line)
  console.log('- line:', firstSuggestion.line)
  console.log('- Lines to replace:', (firstSuggestion.line - firstSuggestion.start_line) + 1)
  console.log('- Body:', firstSuggestion.body)
  
  // The issue: should suggest replacing 2 lines (24,25) but might be calculating wrong lineCount
  const linesBeingReplaced = (firstSuggestion.line - firstSuggestion.start_line) + 1
  console.log('- Expected lines to replace: 1')
  console.log('- Actual lines to replace:', linesBeingReplaced)
  console.log('- Is correct?', linesBeingReplaced === 1)
}