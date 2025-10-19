import parseGitDiff from 'parse-git-diff'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const parsedWorkingDir = parseGitDiff(workingDirDiff)

console.log('=== MAPPING lineBefore to lineAfter ===\n')

const file = parsedWorkingDir.files[0]
file.chunks.forEach((chunk, chunkIdx) => {
  console.log(`\nChunk ${chunkIdx + 1}: fromFileRange.start=${chunk.fromFileRange.start}`)
  
  chunk.changes.forEach(change => {
    if (change.type === 'AddedLine') {
      console.log(`  AddedLine: lineAfter=${change.lineAfter}`)
    } else if (change.type === 'DeletedLine') {
      console.log(`  DeletedLine: lineBefore=${change.lineBefore}`)
    } else if (change.type === 'UnchangedLine') {
      console.log(`  UnchangedLine: lineBefore=${change.lineBefore} -> lineAfter=${change.lineAfter}`)
    }
  })
})

console.log('\n\n=== What lines exist in the PR (new file) ===')
console.log('Lines 1-10 (all AddedLine in the PR diff)')

console.log('\n\n=== What the suggestions should target ===')
console.log('Suggestion 1: Add blank line after "## Example 1"')
console.log('  - Target line in PR: line 1 (the heading itself)')
console.log('  - Calculated from working dir diff: lineBefore=1 (UnchangedLine)')
console.log('')
console.log('Suggestion 2: Add blank line after "Headings should be..."')
console.log('  - Target line in PR: line 2 ("Headings should be...")')
console.log('  - Calculated from working dir diff: lineBefore=4 (DeletedLine) BUT WRONG!')
console.log('  - Should be: lineBefore=3 (UnchangedLine "## Example 2")')
console.log('')
console.log('Suggestion 3: Move line down (remove blank line)')
console.log('  - Target line in PR: line 4 ("There should not be...")')
console.log('  - Calculated from working dir diff: lineBefore=6 (UnchangedLine blank line) BUT WRONG!')
console.log('  - Should be: lineBefore=4 (DeletedLine "There should not be...")')
console.log('')
console.log('Suggestion 4: Add blank line after "```"')
console.log('  - Target line in PR: line 9 (the "```")')
console.log('  - Calculated from working dir diff: lineBefore=9 (UnchangedLine)')
