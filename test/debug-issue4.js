import parseGitDiff from 'parse-git-diff'
import { generateReviewComments } from '../index.js'
import { readFileSync } from 'node:fs'

const workingDirDiff = readFileSync('/tmp/test-working-dir.diff', 'utf8')
const parsedWorkingDir = parseGitDiff(workingDirDiff)

const suggestions = generateReviewComments(parsedWorkingDir)

console.log('=== ORIGINAL FILE (from PR) ===')
const originalLines = [
  '1: ## Example 1',
  '2: Headings should be surrounded by blank lines.',
  '3: ## Example 2',
  '4: There should not be multiple consecutive blank lines.',
  '5: (blank)',
  '6: (blank)',
  '7: ```',
  '8: It even works with fenced code blocks!',
  '9: ```',
  '10: There should be a blank line above this one.'
]
originalLines.forEach(line => console.log(line))

console.log('\n\n=== GENERATED SUGGESTIONS ===')
suggestions.forEach((s, i) => {
  console.log(`\nSuggestion ${i + 1}:`)
  console.log(`  Target line in original file: ${s.line}`)
  if (s.start_line !== undefined) {
    console.log(`  start_line: ${s.start_line}`)
  }
  console.log(`  Content at that line: ${originalLines[s.line - 1]}`)
  console.log(`  Suggestion body:`)
  const lines = s.body.split('\n')
  lines.forEach(line => console.log(`    ${line}`))
})
