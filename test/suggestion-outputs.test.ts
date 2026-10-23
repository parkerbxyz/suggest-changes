import assert from 'node:assert'
import { describe, test } from 'node:test'
import { runWithSuggestionOutputs } from '../src/index.ts'
import type { RunResult } from '../src/types.ts'

interface OutputCall {
  name: string
  value: number
}

interface OutputRecorder {
  calls: OutputCall[]
  write: (name: string, value: number) => void
}

function createOutputRecorder(): OutputRecorder {
  const calls: OutputCall[] = []
  return {
    calls,
    write: (name, value) => calls.push({ name, value }),
  }
}

const noReviewResult: RunResult = {
  comments: [],
  reviewCreated: false,
  suggestionsPosted: 0,
  suggestionsRemaining: 0,
}

const initialOutputCalls: OutputCall[] = [
  { name: 'suggestions-posted', value: 0 },
  { name: 'suggestions-remaining', value: 0 },
]

describe('runWithSuggestionOutputs', () => {
  test('publishes counts after a review is created', async () => {
    const recorder = createOutputRecorder()
    const result: RunResult = {
      comments: [],
      reviewCreated: true,
      suggestionsPosted: 100,
      suggestionsRemaining: 25,
    }

    const returnedResult = await runWithSuggestionOutputs(
      async () => result,
      recorder.write
    )

    assert.strictEqual(returnedResult, result)
    assert.deepStrictEqual(recorder.calls, [
      ...initialOutputCalls,
      { name: 'suggestions-posted', value: 100 },
      { name: 'suggestions-remaining', value: 25 },
    ])
  })

  test('keeps both outputs at zero when no review is created', async () => {
    const recorder = createOutputRecorder()

    await runWithSuggestionOutputs(async () => noReviewResult, recorder.write)

    assert.deepStrictEqual(recorder.calls, [
      ...initialOutputCalls,
      ...initialOutputCalls,
    ])
  })

  test('keeps both outputs at zero after a rate-limit error', async () => {
    const recorder = createOutputRecorder()
    const error = Object.assign(new Error('API rate limit exceeded'), {
      status: 429,
    })

    await assert.rejects(
      runWithSuggestionOutputs(async () => {
        throw error
      }, recorder.write),
      error
    )

    assert.deepStrictEqual(recorder.calls, initialOutputCalls)
  })

  test('keeps both outputs at zero after an ordinary failure', async () => {
    const recorder = createOutputRecorder()
    const error = new Error('Unable to read the event payload')

    await assert.rejects(
      runWithSuggestionOutputs(async () => {
        throw error
      }, recorder.write),
      error
    )

    assert.deepStrictEqual(recorder.calls, initialOutputCalls)
  })
})
