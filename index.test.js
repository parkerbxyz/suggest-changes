// @ts-check
import assert from 'node:assert'
import { describe, test } from 'node:test'
import {
  createMultiLineComment,
  createSingleLineComment,
  generateCommentKey,
  generateSuggestionBody,
  hasNonDeletedContent,
  processChunk,
  validateEvent,
} from './index.js'

describe('generateSuggestionBody', () => {
  test('should generate suggestion body with only AddedLine and UnchangedLine content', () => {
    const changes = [
      { type: 'UnchangedLine', content: 'function example() {' },
      { type: 'DeletedLine', content: '  // This line will be deleted' },
      { type: 'AddedLine', content: '  console.log("Hello");' },
      { type: 'UnchangedLine', content: '}' },
    ]

    const result = generateSuggestionBody(changes)
    const expected =
      '````suggestion\nfunction example() {\n  console.log("Hello");\n}\n````'

    assert.strictEqual(result, expected)
  })

  test('should handle empty changes array', () => {
    const changes = []
    const result = generateSuggestionBody(changes)
    const expected = '````suggestion\n\n````'

    assert.strictEqual(result, expected)
  })

  test('should filter out only DeletedLine content', () => {
    const changes = [
      { type: 'DeletedLine', content: '  // This line will be deleted' },
      { type: 'DeletedLine', content: '  // This line will also be deleted' },
    ]

    const result = generateSuggestionBody(changes)
    const expected = '````suggestion\n\n````'

    assert.strictEqual(result, expected)
  })
})

describe('createSingleLineComment', () => {
  test('should create correct single line comment structure and content', () => {
    const path = 'test.js'
    const toFileRange = { start: 5, lines: 1 }
    const changes = [{ type: 'AddedLine', content: '  console.log("Hello");' }]

    const result = createSingleLineComment(path, toFileRange, changes)

    assert.strictEqual(result.path, 'test.js')
    assert.strictEqual(result.line, 5)
    assert.strictEqual(
      result.body,
      '````suggestion\n  console.log("Hello");\n````'
    )
  })
})

describe('createMultiLineComment', () => {
  test('should create correct multi-line comment structure and content', () => {
    const path = 'test.js'
    const toFileRange = { start: 3, lines: 4 }
    const changes = [
      { type: 'UnchangedLine', content: 'function example() {' },
      { type: 'AddedLine', content: '  console.log("Hello");' },
      { type: 'UnchangedLine', content: '}' },
    ]

    const result = createMultiLineComment(path, toFileRange, changes)

    assert.strictEqual(result.path, 'test.js')
    assert.strictEqual(result.start_line, 3)
    assert.strictEqual(result.line, 6) // start + lines - 1 = 3 + 4 - 1 = 6
    assert.strictEqual(result.start_side, 'RIGHT')
    assert.strictEqual(result.side, 'RIGHT')
    assert.strictEqual(
      result.body,
      '````suggestion\nfunction example() {\n  console.log("Hello");\n}\n````'
    )
  })

  test('should calculate correct line ranges for various scenarios', () => {
    const path = 'test.js'
    const changes = [{ type: 'AddedLine', content: 'test' }]

    // Test different line range calculations
    const testCases = [
      { start: 1, lines: 3, expectedEnd: 3 },
      { start: 10, lines: 5, expectedEnd: 14 },
      { start: 20, lines: 1, expectedEnd: 20 },
    ]

    testCases.forEach(({ start, lines, expectedEnd }) => {
      const toFileRange = { start, lines }
      const result = createMultiLineComment(path, toFileRange, changes)
      assert.strictEqual(result.start_line, start)
      assert.strictEqual(result.line, expectedEnd)
    })
  })
})

describe('hasNonDeletedContent', () => {
  test('should return true when changes contain non-deleted content', () => {
    const testCases = [
      [{ type: 'AddedLine', content: 'added' }],
      [{ type: 'UnchangedLine', content: 'unchanged' }],
      [
        { type: 'AddedLine', content: 'added' },
        { type: 'DeletedLine', content: 'deleted' },
      ],
      [
        { type: 'UnchangedLine', content: 'unchanged' },
        { type: 'AddedLine', content: 'added' },
        { type: 'DeletedLine', content: 'deleted' },
      ],
    ]

    testCases.forEach((changes) => {
      assert.strictEqual(hasNonDeletedContent(changes), true)
    })
  })

  test('should return false when changes contain only deleted content or are empty', () => {
    const testCases = [
      [],
      [{ type: 'DeletedLine', content: 'deleted1' }],
      [
        { type: 'DeletedLine', content: 'deleted1' },
        { type: 'DeletedLine', content: 'deleted2' },
      ],
    ]

    testCases.forEach((changes) => {
      assert.strictEqual(hasNonDeletedContent(changes), false)
    })
  })
})

describe('Integration tests for the fix', () => {
  test('should handle diffs with mixed additions and deletions correctly', () => {
    const path = 'example.js'
    const toFileRange = { start: 12, lines: 3 }
    const changes = [
      { type: 'UnchangedLine', content: 'function example() {' },
      { type: 'DeletedLine', content: '  // This line will be deleted' },
      { type: 'DeletedLine', content: '  // This line will also be deleted' },
      { type: 'AddedLine', content: '  console.log("Hello");' },
      { type: 'UnchangedLine', content: '}' },
    ]

    // Should not be skipped as it has non-deleted content
    assert.strictEqual(hasNonDeletedContent(changes), true)

    // Should create multi-line comment with correct positioning
    const comment = createMultiLineComment(path, toFileRange, changes)
    assert.strictEqual(comment.start_line, 12)
    assert.strictEqual(comment.line, 14) // 12 + 3 - 1

    // Should only include non-deleted lines in suggestion
    const expectedBody =
      '````suggestion\nfunction example() {\n  console.log("Hello");\n}\n````'
    assert.strictEqual(comment.body, expectedBody)
  })

  test('should skip chunks with only deletions', () => {
    const changes = [
      { type: 'DeletedLine', content: '  // This line will be deleted' },
      { type: 'DeletedLine', content: '  // This line will also be deleted' },
    ]

    // Should be skipped as it has only deletions
    assert.strictEqual(hasNonDeletedContent(changes), false)
  })

  test('should handle edge case where toFileRange.lines is 0', () => {
    const path = 'test.js'
    const toFileRange = { start: 5, lines: 0 }
    const changes = [{ type: 'AddedLine', content: '  console.log("Hello");' }]

    // Should create single line comment when lines <= 1
    const comment = createSingleLineComment(path, toFileRange, changes)
    assert.strictEqual(comment.line, 5)
    assert.strictEqual(
      comment.body,
      '````suggestion\n  console.log("Hello");\n````'
    )
  })

  test('should reproduce the exact scenario from issue #50', () => {
    // This test covers the specific example from https://github.com/parkerbxyz/suggest-changes/issues/50
    const path = 'onnxruntime/tools/python/util/fix_long_lines.py'

    // The fix: comment should be made on lines 13-18 in current file state
    const toFileRange = { start: 13, lines: 6 } // Lines 13-18 in current file
    const changes = [
      { type: 'UnchangedLine', content: 'import logging' },
      {
        type: 'DeletedLine',
        content: '_log = logger.get_logger("fix_long_lines", logging.INFO)',
      },
      {
        type: 'AddedLine',
        content: '_log = logger.get_logger("fix_long_lines",',
      },
      { type: 'AddedLine', content: '' },
      { type: 'AddedLine', content: '' },
      { type: 'AddedLine', content: '' },
      { type: 'AddedLine', content: '' },
      { type: 'AddedLine', content: '                         logging.INFO)' },
      { type: 'UnchangedLine', content: 'def main():' },
    ]

    // Should not be skipped - has non-deleted content
    assert.strictEqual(hasNonDeletedContent(changes), true)

    // Should create multi-line comment with correct line positioning
    const comment = createMultiLineComment(path, toFileRange, changes)

    // Line positions should reference current file state (13-18)
    assert.strictEqual(comment.start_line, 13)
    assert.strictEqual(comment.line, 18) // 13 + 6 - 1 = 18
    assert.strictEqual(comment.start_side, 'RIGHT')
    assert.strictEqual(comment.side, 'RIGHT')

    // Suggestion should only include non-deleted content
    const expectedBody =
      '````suggestion\nimport logging\n_log = logger.get_logger("fix_long_lines",\n\n\n\n\n                         logging.INFO)\ndef main():\n````'
    assert.strictEqual(comment.body, expectedBody)
  })
})

describe('generateCommentKey', () => {
  test('should generate unique keys for different comment types', () => {
    const testCases = [
      {
        name: 'single line comment',
        comment: { path: 'test.js', line: 10, body: 'test body' },
        expected: 'test.js:10::test body',
      },
      {
        name: 'multi-line comment',
        comment: { path: 'test.js', start_line: 5, line: 8, body: 'test body' },
        expected: 'test.js:8:5:test body',
      },
      {
        name: 'comment with missing line numbers',
        comment: { path: 'test.js', body: 'test body' },
        expected: 'test.js:::test body',
      },
    ]

    testCases.forEach(({ name, comment, expected }) => {
      const result = generateCommentKey(comment)
      assert.strictEqual(result, expected, `Failed for ${name}`)
    })
  })
})

describe('processChunk', () => {
  test('should return empty array for invalid or skippable chunks', () => {
    const path = 'test.js'
    const existingCommentKeys = new Set()

    const invalidChunks = [
      { type: 'someType' }, // no changes
      { changes: [] }, // no toFileRange
      {
        changes: [{ type: 'DeletedLine', content: 'deleted' }],
        toFileRange: { start: 1, lines: 1 },
      }, // only deletions
    ]

    invalidChunks.forEach((chunk) => {
      const result = processChunk(path, chunk, existingCommentKeys)
      assert.deepStrictEqual(result, [])
    })
  })

  test('should return comment for valid chunk', () => {
    const path = 'test.js'
    const chunk = {
      changes: [{ type: 'AddedLine', content: 'new line' }],
      toFileRange: { start: 1, lines: 1 },
    }
    const existingCommentKeys = new Set()

    const result = processChunk(path, chunk, existingCommentKeys)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].path, 'test.js')
    assert.strictEqual(result[0].line, 1)
  })

  test('should return empty array if comment already exists', () => {
    const path = 'test.js'
    const chunk = {
      changes: [{ type: 'AddedLine', content: 'new line' }],
      toFileRange: { start: 1, lines: 1 },
    }

    // Pre-populate with the comment key that would be generated
    const expectedComment = createSingleLineComment(
      path,
      chunk.toFileRange,
      chunk.changes
    )
    const existingCommentKeys = new Set([generateCommentKey(expectedComment)])

    const result = processChunk(path, chunk, existingCommentKeys)
    assert.deepStrictEqual(result, [])
  })
})

describe('validateEvent', () => {
  test('should return valid events unchanged', () => {
    const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']

    validEvents.forEach((event) => {
      const result = validateEvent(event)
      assert.strictEqual(result, event)
    })
  })

  test('should throw error for invalid events', () => {
    const invalidEvents = ['INVALID', 'approve', 'comment', '', 'MERGE']

    invalidEvents.forEach((event) => {
      assert.throws(
        () => validateEvent(event),
        /Invalid event:/,
        `Should throw for invalid event: ${event}`
      )
    })
  })

  test('should include helpful error message with allowed values', () => {
    try {
      validateEvent('INVALID')
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.ok(error.message.includes('INVALID'))
      assert.ok(error.message.includes('APPROVE'))
      assert.ok(error.message.includes('REQUEST_CHANGES'))
      assert.ok(error.message.includes('COMMENT'))
    }
  })
})
