// @ts-check
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { getGitDiff, generateReviewComments } from '../index.js'

test('Debug suggestions for new-file-issue', async () => {
  const beforeFile = 'test/fixtures/new-file-issue/before.md'
  const afterFile = 'test/fixtures/new-file-issue/after.md'
  
  const diffContent = await getGitDiff(['--no-index', beforeFile, afterFile])
  const parsed = parseGitDiff(diffContent)
  const suggestions = generateReviewComments(parsed).map((s) => ({
    ...s,
    path: beforeFile,
  }))
  
  console.log('Generated suggestions:', JSON.stringify(suggestions, null, 2))
  
  // Also show what applying them does
  const beforeContent = readFileSync(beforeFile, 'utf8')
  const lines = beforeContent.split('\n')
  
  console.log('\nBefore file lines:')
  lines.forEach((line, i) => {
    console.log(`  ${i + 1}: "${line}"`)
  })
  
  console.log('\nSuggestions:')
  suggestions.forEach((s, i) => {
    console.log(`  ${i + 1}. Line ${s.start_line ?? s.line}-${s.line}: ${s.body}`)
  })
})
