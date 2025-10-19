import parseGitDiff from 'parse-git-diff'
import { groupChangesForSuggestions, generateSuggestionBody, calculateLinePosition } from '../index.js'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const parsedWorkingDir = parseGitDiff(workingDirDiff)

const file = parsedWorkingDir.files[0]
const chunk = file.chunks[0]

console.log('=== CHUNK 1 CHANGES ===')
chunk.changes.forEach((change, i) => {
  if (change.type === 'AddedLine') {
    console.log(`${i}: AddedLine lineAfter=${change.lineAfter} content="${change.content}"`)
  } else if (change.type === 'DeletedLine') {
    console.log(`${i}: DeletedLine lineBefore=${change.lineBefore} content="${change.content}"`)
  } else if (change.type === 'UnchangedLine') {
    console.log(`${i}: UnchangedLine lineBefore=${change.lineBefore} lineAfter=${change.lineAfter} content="${change.content}"`)
  }
})

const groups = groupChangesForSuggestions(chunk.changes)

console.log('\n=== GROUP 2 ===')
const group2 = groups[1]
group2.forEach((change, i) => {
  if (change.type === 'AddedLine') {
    console.log(`${i}: AddedLine lineAfter=${change.lineAfter} content="${change.content}"`)
  } else if (change.type === 'DeletedLine') {
    console.log(`${i}: DeletedLine lineBefore=${change.lineBefore} content="${change.content}"`)
  } else if (change.type === 'UnchangedLine') {
    console.log(`${i}: UnchangedLine lineBefore=${change.lineBefore} lineAfter=${change.lineAfter} content="${change.content}"`)
  }
})

const suggestion = generateSuggestionBody(group2)
console.log('\nSuggestion body:', suggestion.body)
console.log('Line count:', suggestion.lineCount)

const { startLine, endLine } = calculateLinePosition(group2, suggestion.lineCount, chunk.fromFileRange)
console.log('Calculated startLine:', startLine)
console.log('Calculated endLine:', endLine)

console.log('\n=== WHAT SHOULD HAPPEN ===')
console.log('This group represents:')
console.log('- Add blank line at lineAfter=4 (between line 3 "Headings..." and line 5 "## Example 2")')
console.log('- Delete "There should not be..." at lineBefore=4')
console.log('- Keep blank line at lineBefore=5 -> lineAfter=6')
console.log('- Add "There should not be..." at lineAfter=7')
console.log('')
console.log('This should be SPLIT into TWO suggestions:')
console.log('1. Add blank line after line 3 (## Example 2)')
console.log('2. Move line 4 ("There should not...") down one line (after blank line at line 5)')
