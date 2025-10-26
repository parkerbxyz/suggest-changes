// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import { generateSuggestionBody, groupChangesForSuggestions } from '../index.js'

// Tests for the grouping algorithm fix for blank line insertions
// When linters add blank lines, we need to group them properly to create clear suggestions
// See https://github.com/parkerbxyz/suggest-changes/issues/118 for more context
describe('Grouping algorithm for blank line insertions', () => {
  test('should create separate groups for each unchanged line followed by blank addition', () => {
    // Simulates adding blank lines after Line A and Line B: Line A (add blank line), Line B (add blank line), Line C
    /** @type {import('../index.js').AnyLineChange[]} */
    const changes = [
      { type: 'UnchangedLine', lineBefore: 1, lineAfter: 1, content: 'Line A' },
      { type: 'AddedLine', lineAfter: 2, content: '' },
      { type: 'UnchangedLine', lineBefore: 2, lineAfter: 3, content: 'Line B' },
      { type: 'AddedLine', lineAfter: 4, content: '' },
      { type: 'UnchangedLine', lineBefore: 3, lineAfter: 5, content: 'Line C' },
    ]

    const groups = groupChangesForSuggestions(changes)

    assert.strictEqual(groups.length, 3)

    // Group 1: [Unchanged Line A, Added blank]
    assert.strictEqual(groups[0].length, 2)
    assert.strictEqual(groups[0][0].content, 'Line A')
    assert.strictEqual(groups[0][1].content, '')

    // Group 2: [Unchanged Line B, Added blank]
    assert.strictEqual(groups[1].length, 2)
    assert.strictEqual(groups[1][0].content, 'Line B')
    assert.strictEqual(groups[1][1].content, '')

    // Group 3: [Unchanged Line C]
    assert.strictEqual(groups[2].length, 1)
    assert.strictEqual(groups[2][0].content, 'Line C')
  })

  test('should generate correct suggestions for blank line insertions', () => {
    /** @type {import('../index.js').AnyLineChange[]} */
    const changes = [
      {
        type: 'UnchangedLine',
        lineBefore: 1,
        lineAfter: 1,
        content: '## Heading',
      },
      { type: 'AddedLine', lineAfter: 2, content: '' },
      {
        type: 'UnchangedLine',
        lineBefore: 2,
        lineAfter: 3,
        content: 'Paragraph text',
      },
    ]

    const groups = groupChangesForSuggestions(changes)

    // First group should suggest "## Heading\n\n"
    const suggestion1 = generateSuggestionBody(groups[0])
    assert.ok(suggestion1)
    assert.match(suggestion1.body, /## Heading/)
    assert.match(suggestion1.body, /````suggestion/)
    assert.strictEqual(suggestion1.lineCount, 1)

    // Second group should not generate a suggestion (only unchanged)
    const suggestion2 = generateSuggestionBody(groups[1])
    assert.strictEqual(suggestion2, null)
  })

  test('should handle multiple blank lines being added', () => {
    /** @type {import('../index.js').AnyLineChange[]} */
    const changes = [
      { type: 'UnchangedLine', lineBefore: 1, lineAfter: 1, content: 'Line A' },
      { type: 'AddedLine', lineAfter: 2, content: '' },
      { type: 'AddedLine', lineAfter: 3, content: '' },
      { type: 'UnchangedLine', lineBefore: 2, lineAfter: 4, content: 'Line B' },
    ]

    const groups = groupChangesForSuggestions(changes)

    // Should create: [Unchanged A, Added blank, Added blank], [Unchanged B]
    assert.strictEqual(groups.length, 2)
    assert.strictEqual(groups[0].length, 3)
    assert.strictEqual(groups[1].length, 1)
  })

  test('should not split groups when there are deletions', () => {
    /** @type {import('../index.js').AnyLineChange[]} */
    const changes = [
      { type: 'UnchangedLine', lineBefore: 1, lineAfter: 1, content: 'Line A' },
      { type: 'DeletedLine', lineBefore: 2, content: 'Old line' },
      { type: 'AddedLine', lineAfter: 2, content: 'New line' },
      { type: 'UnchangedLine', lineBefore: 3, lineAfter: 3, content: 'Line B' },
    ]

    const groups = groupChangesForSuggestions(changes)

    // Should not trigger the special blank line logic when there are deletions
    // The normal grouping logic should apply
    assert.strictEqual(groups.length, 1)
    assert.strictEqual(groups[0].length, 4)
  })

  test('should handle blank line at end of file', () => {
    /** @type {import('../index.js').AnyLineChange[]} */
    const changes = [
      {
        type: 'UnchangedLine',
        lineBefore: 1,
        lineAfter: 1,
        content: 'Last line',
      },
      { type: 'AddedLine', lineAfter: 2, content: '' },
    ]

    const groups = groupChangesForSuggestions(changes)

    assert.strictEqual(groups.length, 1)
    assert.strictEqual(groups[0].length, 2)

    const suggestion = generateSuggestionBody(groups[0])
    assert.ok(suggestion)
    assert.match(suggestion.body, /Last line/)
  })
})
