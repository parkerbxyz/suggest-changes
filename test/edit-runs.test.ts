import assert from 'node:assert'
import { describe, test } from 'node:test'
import parseGitDiff from 'parse-git-diff'
import { createSuggestion, generateReviewComments } from '../src/index.ts'

/**
 * Build a diff string for a single file from hunk lines.
 * @param {string[]} hunkLines - Hunk header and content lines
 * @returns {string} A complete git diff for file.md
 */
function makeDiff(hunkLines) {
  return [
    'diff --git a/file.md b/file.md',
    'index 0000001..0000002 100644',
    '--- a/file.md',
    '+++ b/file.md',
    ...hunkLines,
    '',
  ].join('\n')
}

/**
 * Generate review comments for a raw diff string.
 * @param {string} diff - The diff to process
 * @returns {Array<import('../src/types').ReviewCommentDraft>}
 */
function suggestionsFor(diff) {
  return generateReviewComments(parseGitDiff(diff))
}

/**
 * Apply a single suggestion to file content (same semantics as GitHub).
 * @param {string} content - The original file content
 * @param {import('../src/types').ReviewCommentDraft} suggestion - The suggestion to apply
 * @returns {string} The content with the suggestion applied
 */
function applySuggestion(content, suggestion) {
  const lines = content.split('\n')
  const match = suggestion.body.match(/^````suggestion\n([\s\S]*)\n````$/)
  if (!match) throw new Error(`Invalid suggestion body: ${suggestion.body}`)
  const suggestionLines = match[1] === '' ? [] : match[1].split('\n')
  const startIndex = (suggestion.start_line ?? suggestion.line) - 1
  const endIndex = suggestion.line - 1
  return [
    ...lines.slice(0, startIndex),
    ...suggestionLines,
    ...lines.slice(endIndex + 1),
  ].join('\n')
}

/**
 * Apply suggestions bottom-up so earlier applications do not shift line numbers.
 * @param {string} content - The original file content
 * @param {Array<import('../src/types').ReviewCommentDraft>} suggestions
 * @returns {string} The content with all suggestions applied
 */
function applySuggestions(content, suggestions) {
  const ordered = [...suggestions].sort(
    (a, b) => (b.start_line ?? b.line) - (a.start_line ?? a.line)
  )
  return ordered.reduce(applySuggestion, content)
}

describe('Edit run suggestions', () => {
  describe('Bug 1: pure insertions without leading context must not destroy content', () => {
    test('insertion at top of file anchors line 1 and preserves its content', () => {
      const diff = makeDiff([
        '@@ -1,1 +1,3 @@',
        '+# New Title',
        '+',
        ' first original line',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 1)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(
        suggestions[0].body,
        createSuggestion('# New Title\n\nfirst original line')
      )

      const before = 'first original line'
      const after = '# New Title\n\nfirst original line'
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('insertion without leading context in hunk anchors one adjacent line only', () => {
      const diff = makeDiff([
        '@@ -4,1 +4,3 @@',
        '+inserted A',
        '+inserted B',
        ' original line 4',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 4)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(
        suggestions[0].body,
        createSuggestion('inserted A\ninserted B\noriginal line 4')
      )

      const before = ['line 1', 'line 2', 'line 3', 'original line 4'].join('\n')
      const after = [
        'line 1',
        'line 2',
        'line 3',
        'inserted A',
        'inserted B',
        'original line 4',
      ].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })
  })

  describe('Bug 2: identical delete/add content must not be treated as a movement', () => {
    test('unrelated brace edits produce a deletion and an insertion, not a merged rewrite', () => {
      const diff = [
        'diff --git a/file.js b/file.js',
        'index 0000001..0000002 100644',
        '--- a/file.js',
        '+++ b/file.js',
        '@@ -3,6 +3,6 @@',
        ' function foo() {',
        '-}',
        ' const x = 1',
        ' if (x) {',
        '   doThing()',
        '+}',
        ' done()',
        '',
      ].join('\n')

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 2)

      // Deletion of the brace at its original position (line 4)
      assert.strictEqual(suggestions[0].line, 4)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(suggestions[0].body, createSuggestion(''))

      // Insertion of the brace after doThing(), anchored on the adjacent line
      assert.strictEqual(suggestions[1].line, 7)
      assert.strictEqual(suggestions[1].start_line, undefined)
      assert.strictEqual(suggestions[1].body, createSuggestion('  doThing()\n}'))

      const before = [
        'a',
        'b',
        'function foo() {',
        '}',
        'const x = 1',
        'if (x) {',
        '  doThing()',
        'done()',
      ].join('\n')
      const after = [
        'a',
        'b',
        'function foo() {',
        'const x = 1',
        'if (x) {',
        '  doThing()',
        '}',
        'done()',
      ].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })
  })

  describe('Pure insertion coverage', () => {
    test('insertion between lines anchors the preceding line', () => {
      const diff = makeDiff([
        '@@ -2,2 +2,3 @@',
        ' line two',
        '+inserted',
        ' line three',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 2)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(
        suggestions[0].body,
        createSuggestion('line two\ninserted')
      )
    })

    test('insertion at end of file anchors the last existing line', () => {
      const diff = makeDiff(['@@ -4,1 +4,2 @@', ' last line', '+appended'])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 4)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(
        suggestions[0].body,
        createSuggestion('last line\nappended')
      )
    })

    test('consecutive insertion runs in one file produce separate suggestions', () => {
      const diff = makeDiff([
        '@@ -1,3 +1,5 @@',
        ' alpha',
        '+one',
        ' beta',
        '+two',
        ' gamma',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 2)
      assert.strictEqual(suggestions[0].line, 1)
      assert.strictEqual(suggestions[0].body, createSuggestion('alpha\none'))
      assert.strictEqual(suggestions[1].line, 2)
      assert.strictEqual(suggestions[1].body, createSuggestion('beta\ntwo'))

      const before = ['alpha', 'beta', 'gamma'].join('\n')
      const after = ['alpha', 'one', 'beta', 'two', 'gamma'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('insertions at top of file and after line 1 merge into one suggestion', () => {
      // Both runs must anchor line 1 (the only adjacent existing line), so they
      // merge into a single suggestion instead of two conflicting ones.
      const diff = makeDiff([
        '@@ -1,2 +1,4 @@',
        '+top',
        ' alpha',
        '+after',
        ' beta',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 1)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(
        suggestions[0].body,
        createSuggestion('top\nalpha\nafter')
      )

      const before = ['alpha', 'beta'].join('\n')
      const after = ['top', 'alpha', 'after', 'beta'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('additions to an empty file produce no suggestions', () => {
      // There is no existing line to anchor a suggestion to.
      const diff = makeDiff(['@@ -0,0 +1,2 @@', '+hello', '+world'])

      const suggestions = suggestionsFor(diff)

      assert.deepStrictEqual(suggestions, [])
    })
  })

  describe('Adjacent line moves', () => {
    test('content moving down past a blank line is one atomic suggestion', () => {
      // The linter blank-line pattern: inserting a blank before a line shows
      // up as delete line, keep blank, re-add line one position later.
      const diff = makeDiff([
        '@@ -1,4 +1,4 @@',
        ' heading',
        '-moved line',
        ' ',
        '+moved line',
        ' tail',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].start_line, 2)
      assert.strictEqual(suggestions[0].line, 3)
      assert.strictEqual(suggestions[0].start_side, 'RIGHT')
      assert.strictEqual(suggestions[0].body, createSuggestion('\nmoved line'))

      const before = ['heading', 'moved line', '', 'tail'].join('\n')
      const after = ['heading', '', 'moved line', 'tail'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('content moving up past its neighbor is one atomic suggestion', () => {
      const diff = makeDiff([
        '@@ -1,3 +1,3 @@',
        ' first',
        '+third',
        ' second',
        '-third',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].start_line, 2)
      assert.strictEqual(suggestions[0].line, 3)
      assert.strictEqual(suggestions[0].body, createSuggestion('third\nsecond'))

      const before = ['first', 'second', 'third'].join('\n')
      const after = ['first', 'third', 'second'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('multiple lines moving together merge into one suggestion', () => {
      const diff = makeDiff([
        '@@ -1,5 +1,5 @@',
        ' x',
        '-m1',
        '-m2',
        ' u',
        '+m1',
        '+m2',
        ' y',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].start_line, 2)
      assert.strictEqual(suggestions[0].line, 4)
      assert.strictEqual(suggestions[0].body, createSuggestion('u\nm1\nm2'))

      const before = ['x', 'm1', 'm2', 'u', 'y'].join('\n')
      const after = ['x', 'u', 'm1', 'm2', 'y'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('identical lines more than one line apart stay separate suggestions', () => {
      const diff = makeDiff([
        '@@ -1,5 +1,5 @@',
        ' a',
        '-}',
        ' b',
        ' c',
        '+}',
        ' d',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 2)
      assert.strictEqual(suggestions[0].line, 2)
      assert.strictEqual(suggestions[0].body, createSuggestion(''))
      assert.strictEqual(suggestions[1].line, 4)
      assert.strictEqual(suggestions[1].body, createSuggestion('c\n}'))

      const before = ['a', '}', 'b', 'c', 'd'].join('\n')
      const after = ['a', 'b', 'c', '}', 'd'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('differing content one line apart stays separate suggestions', () => {
      const diff = makeDiff([
        '@@ -1,4 +1,4 @@',
        ' a',
        '-old',
        ' b',
        '+new',
        ' c',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 2)
      assert.strictEqual(suggestions[0].line, 2)
      assert.strictEqual(suggestions[0].body, createSuggestion(''))
      assert.strictEqual(suggestions[1].line, 3)
      assert.strictEqual(suggestions[1].body, createSuggestion('b\nnew'))

      const before = ['a', 'old', 'b', 'c'].join('\n')
      const after = ['a', 'b', 'new', 'c'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })
  })

  describe('Replacements and deletions', () => {
    test('multi-line replacement anchors exactly the deleted lines', () => {
      const diff = makeDiff([
        '@@ -1,4 +1,3 @@',
        ' keep one',
        '-old two',
        '-old three',
        '+new two',
        ' keep four',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].start_line, 2)
      assert.strictEqual(suggestions[0].line, 3)
      assert.strictEqual(suggestions[0].start_side, 'RIGHT')
      assert.strictEqual(suggestions[0].body, createSuggestion('new two'))

      const before = ['keep one', 'old two', 'old three', 'keep four'].join('\n')
      const after = ['keep one', 'new two', 'keep four'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })

    test('pure deletion anchors the deleted line with an empty suggestion', () => {
      const diff = makeDiff([
        '@@ -1,3 +1,2 @@',
        ' keep one',
        '-remove me',
        ' keep three',
      ])

      const suggestions = suggestionsFor(diff)

      assert.strictEqual(suggestions.length, 1)
      assert.strictEqual(suggestions[0].line, 2)
      assert.strictEqual(suggestions[0].start_line, undefined)
      assert.strictEqual(suggestions[0].body, createSuggestion(''))

      const before = ['keep one', 'remove me', 'keep three'].join('\n')
      const after = ['keep one', 'keep three'].join('\n')
      assert.strictEqual(applySuggestions(before, suggestions), after)
    })
  })
})
