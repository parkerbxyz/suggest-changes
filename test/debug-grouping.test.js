// @ts-check
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { groupChangesForSuggestions, generateSuggestionBody, calculateLinePosition } from '../index.js'

test('Debug grouping for new-file-issue', async () => {
  // Read the diff for the new-file-issue fixture
  const diffContent = readFileSync('test/fixtures/new-file-issue/diff.txt', 'utf8')
  const parsed = parseGitDiff(diffContent)

  console.log('=== PARSED DIFF ===')
  for (const file of parsed.files) {
    console.log(`File: ${file.path}`)
    for (const chunk of file.chunks) {
      if (chunk.type !== 'Chunk') continue
      console.log(`  Chunk: lines ${chunk.fromFileRange.start}-${chunk.fromFileRange.start + chunk.fromFileRange.length - 1}`)
      console.log(`  Changes (${chunk.changes.length} total):`)
      for (const change of chunk.changes) {
        if (change.type === 'DeletedLine') {
          console.log(`    - [D] Line ${change.lineBefore}: "${change.content}"`)
        } else if (change.type === 'AddedLine') {
          console.log(`    - [A] Line ${change.lineAfter}: "${change.content}"`)
        } else if (change.type === 'UnchangedLine') {
          console.log(`    - [U] Line ${change.lineBefore}/${change.lineAfter}: "${change.content}"`)
        }
      }
      
      console.log(`\n  Groups:`)
      const groups = groupChangesForSuggestions(chunk.changes)
      groups.forEach((group, i) => {
        console.log(`\n  Group ${i + 1} (${group.length} changes):`)
        for (const change of group) {
          if (change.type === 'DeletedLine') {
            console.log(`    - [D] Line ${change.lineBefore}: "${change.content}"`)
          } else if (change.type === 'AddedLine') {
            console.log(`    - [A] Line ${change.lineAfter}: "${change.content}"`)
          } else if (change.type === 'UnchangedLine') {
            console.log(`    - [U] Line ${change.lineBefore}/${change.lineAfter}: "${change.content}"`)
          }
        }
        
        const suggestion = generateSuggestionBody(group)
        if (suggestion) {
          console.log(`  Suggestion body: ${JSON.stringify(suggestion.body)}`)
          console.log(`  Line count: ${suggestion.lineCount}`)
          const { startLine, endLine } = calculateLinePosition(group, suggestion.lineCount, chunk.fromFileRange)
          console.log(`  Position: ${startLine}-${endLine}`)
        } else {
          console.log(`  No suggestion generated`)
        }
      })
    }
  }
})
