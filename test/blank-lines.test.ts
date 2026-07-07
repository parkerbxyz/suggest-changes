import assert from 'node:assert'
import { describe, test } from 'node:test'
import { createSuggestion } from '../src/index.ts'
import { makeDiff, suggestionsFor } from './helpers.ts'

// Tests for blank line insertions
// When linters add blank lines, each insertion should become its own clear,
// single-line-anchored suggestion that preserves the anchored line's content.
// See https://github.com/parkerbxyz/suggest-changes/issues/118 for more context
describe('Blank line insertion suggestions', () => {
  test('should create a separate suggestion for each inserted blank line', () => {
    // Simulates adding blank lines after Line A and Line B
    const diff = makeDiff([
      '@@ -1,3 +1,5 @@',
      ' Line A',
      '+',
      ' Line B',
      '+',
      ' Line C',
    ])

    const suggestions = suggestionsFor(diff)

    assert.strictEqual(suggestions.length, 2)

    assert.strictEqual(suggestions[0].line, 1)
    assert.strictEqual(suggestions[0].start_line, undefined)
    assert.strictEqual(suggestions[0].body, createSuggestion('Line A\n'))

    assert.strictEqual(suggestions[1].line, 2)
    assert.strictEqual(suggestions[1].start_line, undefined)
    assert.strictEqual(suggestions[1].body, createSuggestion('Line B\n'))
  })

  test('should anchor a blank line inserted after a heading to the heading', () => {
    const diff = makeDiff([
      '@@ -1,2 +1,3 @@',
      ' ## Heading',
      '+',
      ' Paragraph text',
    ])

    const suggestions = suggestionsFor(diff)

    assert.strictEqual(suggestions.length, 1)
    assert.strictEqual(suggestions[0].line, 1)
    assert.match(suggestions[0].body, /## Heading/)
    assert.match(suggestions[0].body, /````suggestion/)
  })

  test('should keep multiple blank lines added at the same spot in one suggestion', () => {
    const diff = makeDiff([
      '@@ -1,2 +1,4 @@',
      ' Line A',
      '+',
      '+',
      ' Line B',
    ])

    const suggestions = suggestionsFor(diff)

    assert.strictEqual(suggestions.length, 1)
    assert.strictEqual(suggestions[0].line, 1)
    assert.strictEqual(suggestions[0].body, createSuggestion('Line A\n\n'))
  })

  test('should treat a replacement next to context lines as a single replacement suggestion', () => {
    const diff = makeDiff([
      '@@ -1,3 +1,3 @@',
      ' Line A',
      '-Old line',
      '+New line',
      ' Line B',
    ])

    const suggestions = suggestionsFor(diff)

    assert.strictEqual(suggestions.length, 1)
    assert.strictEqual(suggestions[0].line, 2)
    assert.strictEqual(suggestions[0].start_line, undefined)
    assert.strictEqual(suggestions[0].body, createSuggestion('New line'))
  })

  test('should handle a blank line added at end of file', () => {
    const diff = makeDiff(['@@ -1,1 +1,2 @@', ' Last line', '+'])

    const suggestions = suggestionsFor(diff)

    assert.strictEqual(suggestions.length, 1)
    assert.strictEqual(suggestions[0].line, 1)
    assert.strictEqual(suggestions[0].body, createSuggestion('Last line\n'))
  })
})
