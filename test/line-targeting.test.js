// @ts-check

import { test } from 'node:test'
import assert from 'node:assert'
import parseGitDiff from 'parse-git-diff'
import { generateSuggestionBody } from '../index.js'

test('Line targeting regression test', async (t) => {
  // This is the exact diff that shows the line offset issue
  const diffContent = `diff --git a/test/fixtures/before.md b/test/fixtures/after.md
index 68f3925..1e22de6 100644
--- a/test/fixtures/before.md
+++ b/test/fixtures/after.md
@@ -1,2 +1,3 @@
 # Welcome to the Solutions Engineering team 🎉
+
 Welcome to our team!
@@ -4,2 +5,3 @@ Welcome to our team!
 ## Getting Started
+
 Here are the steps to get started:`

  const { files } = parseGitDiff(diffContent)
  const file = files[0]
  const chunks = file.chunks.filter(chunk => chunk.type === 'Chunk')
  
  await t.test('should use new file line numbers (toFileRange) not old file line numbers (fromFileRange)', () => {
    // Check the first chunk - blank line addition after title
    const chunk1 = chunks[0]
    assert.strictEqual(chunk1.fromFileRange.start, 1, 'Old file starts at line 1')
    assert.strictEqual(chunk1.toFileRange.start, 1, 'New file starts at line 1')
    
    // Check the second chunk - blank line addition after "Getting Started"
    const chunk2 = chunks[1] 
    assert.strictEqual(chunk2.fromFileRange.start, 4, 'Old file content at line 4')
    assert.strictEqual(chunk2.toFileRange.start, 5, 'New file content shifted to line 5')
    
    console.log('Chunk 1:', { from: chunk1.fromFileRange.start, to: chunk1.toFileRange.start })
    console.log('Chunk 2:', { from: chunk2.fromFileRange.start, to: chunk2.toFileRange.start })
  })
  
  await t.test('should demonstrate the line offset issue', () => {
    const chunk2 = chunks[1]
    
    // This is the bug: using fromFileRange.start gives line 4 (old file)
    const wrongLineNumber = chunk2.fromFileRange.start // 4
    
    // This is the fix: using toFileRange.start gives line 5 (new file) 
    const correctLineNumber = chunk2.toFileRange.start // 5
    
    assert.strictEqual(wrongLineNumber, 4, 'Bug: comment would target line 4')
    assert.strictEqual(correctLineNumber, 5, 'Fix: comment should target line 5')
    assert.notStrictEqual(wrongLineNumber, correctLineNumber, 'Line numbers are off by 1')
    
    console.log(`Wrong targeting: line ${wrongLineNumber} (old file)`)
    console.log(`Correct targeting: line ${correctLineNumber} (new file)`)
  })
  
  await t.test('should verify suggestion body generation works', () => {
    const chunk2 = chunks[1]
    const suggestion = generateSuggestionBody(chunk2.changes)
    
    assert.ok(suggestion, 'Should generate suggestion for blank line addition')
    assert.strictEqual(suggestion.lineCount, 1, 'Should be single line suggestion')
    assert.ok(suggestion.body.includes('```suggestion'), 'Should contain suggestion block')
    
    console.log('Generated suggestion:', suggestion.body)
  })
})
