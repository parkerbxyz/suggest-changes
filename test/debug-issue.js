import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../index.js'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const prDiff = readFileSync('/tmp/test-new-file-pr.diff', 'utf8')

console.log('=== WORKING DIR DIFF ===')
console.log(workingDirDiff)

console.log('\n=== PR DIFF ===')
console.log(prDiff)

console.log('\n=== PARSED WORKING DIR DIFF ===')
const parsedWorkingDir = parseGitDiff(workingDirDiff)
console.log(JSON.stringify(parsedWorkingDir, null, 2))

console.log('\n=== PARSED PR DIFF ===')
const parsedPR = parseGitDiff(prDiff)
console.log(JSON.stringify(parsedPR, null, 2))

console.log('\n=== GENERATED SUGGESTIONS FROM WORKING DIR DIFF ===')
const suggestions = generateReviewComments(parsedWorkingDir)
suggestions.forEach((s, i) => {
  console.log(`\nSuggestion ${i + 1}:`)
  console.log(`  path: ${s.path}`)
  console.log(`  line: ${s.line}`)
  if (s.start_line !== undefined) {
    console.log(`  start_line: ${s.start_line}`)
  }
  console.log(`  body:`)
  console.log(s.body.split('\n').map(line => `  ${line}`).join('\n'))
})

console.log('\n=== CHECKING WHICH LINES ARE VALID IN PR DIFF ===')
const prFile = parsedPR.files.find(f => f.path === 'example.md')
if (prFile && prFile.type === 'ChangedFile') {
  for (const chunk of prFile.chunks) {
    if (chunk.type === 'Chunk') {
      console.log(`\nChunk: ${chunk.fromFileRange.start}-${chunk.fromFileRange.start + chunk.fromFileRange.length - 1} => ${chunk.toFileRange.start}-${chunk.toFileRange.start + chunk.toFileRange.length - 1}`)
      chunk.changes.forEach(change => {
        if (change.type === 'AddedLine') {
          console.log(`  Line ${change.lineAfter}: ${change.content}`)
        } else if (change.type === 'UnchangedLine') {
          console.log(`  Line ${change.lineAfter} (unchanged): ${change.content}`)
        }
      })
    }
  }
}
