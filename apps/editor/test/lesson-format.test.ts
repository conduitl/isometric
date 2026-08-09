/**
 * The mini-instruction formatter, pinned. The contract worth defending:
 * exactly **bold**, `code`, and blank-line paragraphs — and an author's
 * typo (an unterminated marker) renders literally instead of eating the
 * rest of their sentence.
 */

import { describe, expect, it } from 'vitest'
import { formatInstruction } from '../src/editor/lesson/format'

describe('paragraphs', () => {
  it('empty string yields no paragraphs', () => {
    expect(formatInstruction('')).toEqual([])
  })

  it('whitespace-only input yields no paragraphs', () => {
    expect(formatInstruction('  \n\n \t \n ')).toEqual([])
  })

  it('plain prose is one paragraph, one text span', () => {
    expect(formatInstruction('Paint one square.')).toEqual([
      { spans: [{ kind: 'text', text: 'Paint one square.' }] },
    ])
  })

  it('a blank line separates paragraphs; runs of blank lines collapse', () => {
    expect(formatInstruction('First.\n\nSecond.\n\n\n\nThird.')).toEqual([
      { spans: [{ kind: 'text', text: 'First.' }] },
      { spans: [{ kind: 'text', text: 'Second.' }] },
      { spans: [{ kind: 'text', text: 'Third.' }] },
    ])
  })

  it('a lone line break is just a space — authors hard-wrap freely', () => {
    expect(formatInstruction('one\ntwo')).toEqual([{ spans: [{ kind: 'text', text: 'one two' }] }])
  })

  it('a whitespace-only line still counts as blank', () => {
    expect(formatInstruction('a\n   \nb')).toEqual([
      { spans: [{ kind: 'text', text: 'a' }] },
      { spans: [{ kind: 'text', text: 'b' }] },
    ])
  })
})

describe('bold and code spans', () => {
  it('**bold** in the middle of prose splits into three spans', () => {
    expect(formatInstruction('press the **Save** button')).toEqual([
      {
        spans: [
          { kind: 'text', text: 'press the ' },
          { kind: 'bold', text: 'Save' },
          { kind: 'text', text: ' button' },
        ],
      },
    ])
  })

  it('`code` spans carry their content without the backticks', () => {
    expect(formatInstruction('the cell at `(5, 4)`')).toEqual([
      {
        spans: [
          { kind: 'text', text: 'the cell at ' },
          { kind: 'code', text: '(5, 4)' },
        ],
      },
    ])
  })

  it('bold and code coexist in one paragraph', () => {
    expect(formatInstruction('paint **water** at `(5, 4)` now')).toEqual([
      {
        spans: [
          { kind: 'text', text: 'paint ' },
          { kind: 'bold', text: 'water' },
          { kind: 'text', text: ' at ' },
          { kind: 'code', text: '(5, 4)' },
          { kind: 'text', text: ' now' },
        ],
      },
    ])
  })

  it('a span can open the paragraph and another can close it', () => {
    expect(formatInstruction('**Save** your `world`')).toEqual([
      {
        spans: [
          { kind: 'bold', text: 'Save' },
          { kind: 'text', text: ' your ' },
          { kind: 'code', text: 'world' },
        ],
      },
    ])
  })
})

describe('nesting-free by design', () => {
  it('backticks inside bold are literal text', () => {
    expect(formatInstruction('**press `Esc` now**')).toEqual([
      { spans: [{ kind: 'bold', text: 'press `Esc` now' }] },
    ])
  })

  it('asterisks inside code are literal text', () => {
    expect(formatInstruction('`a ** b`')).toEqual([{ spans: [{ kind: 'code', text: 'a ** b' }] }])
  })
})

describe('unterminated markers stay literal — a typo never eats the prose', () => {
  it('a lone ** renders as text, sentence intact', () => {
    expect(formatInstruction('press **Save to keep your world')).toEqual([
      { spans: [{ kind: 'text', text: 'press **Save to keep your world' }] },
    ])
  })

  it('a lone backtick renders as text (the apostrophe typo)', () => {
    expect(formatInstruction('don`t worry')).toEqual([{ spans: [{ kind: 'text', text: 'don`t worry' }] }])
  })

  it('a proper span still parses after an earlier unterminated marker of the other kind', () => {
    expect(formatInstruction('don`t forget to press **Save**')).toEqual([
      {
        spans: [
          { kind: 'text', text: 'don`t forget to press ' },
          { kind: 'bold', text: 'Save' },
        ],
      },
    ])
  })
})
