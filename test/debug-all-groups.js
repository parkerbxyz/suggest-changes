import parseGitDiff from 'parse-git-diff'
import { groupChangesForSuggestions } from '../index.js'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const parsedWorkingDir = parseGitDiff(workingDirDiff)

const file = parsedWorkingDir.files[0]
const chunk = file.chunks[0]

console.log('=== CHUNK 1 CHANGES ===')
chunk.changes.forEach((change, i) => {
  const desc = change.type === 'AddedLine' 
    ? `AddedLine lineAfter=${change.lineAfter}`
    : change.type === 'DeletedLine'
    ? `DeletedLine lineBefore=${change.lineBefore}`
    : `UnchangedLine lineBefore=${change.lineBefore} lineAfter=${change.lineAfter}`
  console.log(`${i}: ${desc} content="${change.content}"`)
})

const groups = groupChangesForSuggestions(chunk.changes)

console.log(`\n=== GROUPS (${groups.length} total) ===`)
groups.forEach((group, i) => {
  console.log(`\nGroup ${i + 1}:`)
  group.forEach((change, j) => {
    const desc = change.type === 'AddedLine' 
      ? `AddedLine lineAfter=${change.lineAfter}`
      : change.type === 'DeletedLine'
      ? `DeletedLine lineBefore=${change.lineBefore}`
      : `UnchangedLine lineBefore=${change.lineBefore} lineAfter=${change.lineAfter}`
    console.log(`  ${j}: ${desc} content="${change.content}"`)
  })
})
