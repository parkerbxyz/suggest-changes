import parseGitDiff from 'parse-git-diff'
import { generateReviewComments, groupChangesForSuggestions, generateSuggestionBody, calculateLinePosition } from '../index.js'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const parsedWorkingDir = parseGitDiff(workingDirDiff)

console.log('=== DETAILED SUGGESTION GENERATION ===\n')

const file = parsedWorkingDir.files[0]
file.chunks.forEach((chunk, chunkIdx) => {
  console.log(`\n--- Chunk ${chunkIdx + 1} ---`)
  console.log(`fromFileRange: start=${chunk.fromFileRange.start}, lines=${chunk.fromFileRange.lines}`)
  console.log(`toFileRange: start=${chunk.toFileRange.start}, lines=${chunk.toFileRange.lines}`)
  
  const groups = groupChangesForSuggestions(chunk.changes)
  console.log(`\nGroups found: ${groups.length}`)
  
  groups.forEach((group, groupIdx) => {
    console.log(`\n  Group ${groupIdx + 1}:`)
    group.forEach(change => {
      if (change.type === 'AddedLine') {
        console.log(`    AddedLine: lineAfter=${change.lineAfter}, content="${change.content}"`)
      } else if (change.type === 'DeletedLine') {
        console.log(`    DeletedLine: lineBefore=${change.lineBefore}, content="${change.content}"`)
      } else if (change.type === 'UnchangedLine') {
        console.log(`    UnchangedLine: lineBefore=${change.lineBefore}, lineAfter=${change.lineAfter}, content="${change.content}"`)
      }
    })
    
    const suggestion = generateSuggestionBody(group)
    if (suggestion) {
      const { body, lineCount } = suggestion
      const { startLine, endLine } = calculateLinePosition(group, lineCount, chunk.fromFileRange)
      
      console.log(`\n    Suggestion:`)
      console.log(`      lineCount: ${lineCount}`)
      console.log(`      startLine (calculated): ${startLine}`)
      console.log(`      endLine (calculated): ${endLine}`)
      console.log(`      body: ${body.substring(0, 50)}...`)
    }
  })
})
