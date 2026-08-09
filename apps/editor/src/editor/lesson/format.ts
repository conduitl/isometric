/**
 * The mini-instruction formatter — the ONLY markup lesson prose gets.
 *
 * Lesson instructions support exactly three things: `**bold**`, `` `code` ``,
 * and blank-line paragraph breaks. That ceiling is deliberate, twice over:
 *
 * 1. **No markdown dependency enters the tree.** A real markdown parser is a
 *    large, evolving dependency for what lessons actually need — two span
 *    kinds and paragraphs. Owning these ~60 lines costs less than auditing
 *    someone else's thousands (docs/DECISIONS.md: every dep needs a priced
 *    escape hatch — this one's price is "we already wrote it").
 * 2. **Authors get a floor they cannot fall through.** An unterminated
 *    marker — `**oops` with no closer, an apostrophe typed as a backtick —
 *    renders LITERALLY instead of silently swallowing the rest of the
 *    sentence. A curriculum author's typo must never eat their words.
 *
 * Nesting-free by design: inside a bold span, backticks are literal text;
 * inside a code span, asterisks are. Whichever marker opens first wins the
 * region. Hard-wrapped source lines join with a single space (authors wrap
 * where they like); only a blank line starts a new paragraph.
 *
 * Pure data in, pure data out — the React rail maps Paragraph[]/Span[] to
 * elements, but nothing here knows the DOM exists.
 */

/** One run of same-styled text. `text` is the content only — markers are
 * consumed, never included (except when unterminated, where they surface
 * literally inside a plain text span). */
export interface Span {
  readonly kind: 'text' | 'bold' | 'code'
  readonly text: string
}

/** One paragraph of an instruction: its spans in reading order. */
export interface Paragraph {
  readonly spans: readonly Span[]
}

/**
 * Parse mini-markdown instruction text into paragraphs of spans.
 * Empty or whitespace-only input yields `[]` — the rail simply renders
 * nothing, which is also the harness's "lesson done" instruction state.
 */
export function formatInstruction(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  // A blank line (whitespace-only counts) separates paragraphs; runs of
  // blank lines collapse — three returns do not make an empty paragraph.
  for (const block of text.split(/\n\s*\n/)) {
    // Within a paragraph, line breaks and repeated whitespace are just
    // spacing — authors hard-wrap their source lines wherever reads well.
    const flat = block.replace(/\s+/g, ' ').trim()
    if (flat === '') continue
    paragraphs.push({ spans: parseSpans(flat) })
  }
  return paragraphs
}

/** Left-to-right single pass: first marker wins, closers are searched
 * verbatim, and a marker with no closer degrades to literal text. */
function parseSpans(text: string): Span[] {
  const spans: Span[] = []
  let plain = ''
  const flush = (): void => {
    if (plain !== '') {
      spans.push({ kind: 'text', text: plain })
      plain = ''
    }
  }

  let i = 0
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2)
      if (close !== -1) {
        const inner = text.slice(i + 2, close)
        if (inner !== '') {
          flush()
          spans.push({ kind: 'bold', text: inner })
        }
        i = close + 2
        continue
      }
      plain += '**' // unterminated: the marker stays visible, the prose survives
      i += 2
      continue
    }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close !== -1) {
        const inner = text.slice(i + 1, close)
        if (inner !== '') {
          flush()
          spans.push({ kind: 'code', text: inner })
        }
        i = close + 1
        continue
      }
      plain += '`' // unterminated: same mercy
      i += 1
      continue
    }
    plain += text[i]
    i += 1
  }
  flush()
  return spans
}
