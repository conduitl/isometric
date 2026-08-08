import { describe, expect, it } from 'vitest'
import { createNullBackend } from '../src/null-backend'

const view = { width: 800, height: 450, dpr: 1 }

describe('createNullBackend', () => {
  it('is named "null" and starts with an empty log', () => {
    const backend = createNullBackend()
    expect(backend.name).toBe('null')
    expect(backend.frames).toEqual([])
  })

  it('records one frame as a begin → commands → end sandwich, verbatim and in order', () => {
    const backend = createNullBackend()

    backend.beginFrame({ ...view, background: '#123456' })
    backend.drawRect({ x: 1, y: 2, width: 3, height: 4, fill: '#f00' })
    backend.drawCircle({ x: 10, y: 20, radius: 5, stroke: '#0f0', lineWidth: 2 })
    backend.drawPolyline({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      stroke: '#00f',
      closed: true,
    })
    backend.drawText({ x: 8, y: 16, text: 'tick 42', align: 'left', baseline: 'top' })
    backend.endFrame()

    expect(backend.frames).toEqual([
      [
        { kind: 'begin', width: 800, height: 450, dpr: 1, background: '#123456' },
        { kind: 'rect', x: 1, y: 2, width: 3, height: 4, fill: '#f00' },
        { kind: 'circle', x: 10, y: 20, radius: 5, stroke: '#0f0', lineWidth: 2 },
        {
          kind: 'polyline',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0 },
          ],
          stroke: '#00f',
          closed: true,
        },
        { kind: 'text', x: 8, y: 16, text: 'tick 42', align: 'left', baseline: 'top' },
        { kind: 'end' },
      ],
    ])
  })

  it('omits optional fields the caller did not pass (the log is exactly what crossed the seam)', () => {
    const backend = createNullBackend()
    backend.beginFrame(view)
    backend.drawRect({ x: 0, y: 0, width: 1, height: 1 })
    backend.endFrame()

    const frame = backend.frames[0]
    expect(frame).toBeDefined()
    const begin = frame?.[0]
    const rect = frame?.[1]
    expect(begin).toBeDefined()
    expect(rect).toBeDefined()
    expect('background' in (begin as object)).toBe(false)
    expect('fill' in (rect as object)).toBe(false)
    expect('stroke' in (rect as object)).toBe(false)
    expect('lineWidth' in (rect as object)).toBe(false)
  })

  it('splits commands across frames at begin/end boundaries', () => {
    const backend = createNullBackend()

    backend.beginFrame(view)
    backend.drawRect({ x: 1, y: 1, width: 1, height: 1 })
    backend.endFrame()

    backend.beginFrame(view)
    backend.drawCircle({ x: 2, y: 2, radius: 2 })
    backend.drawText({ x: 3, y: 3, text: 'second frame' })
    backend.endFrame()

    expect(backend.frames).toHaveLength(2)
    expect(backend.frames[0]).toEqual([
      { kind: 'begin', ...view },
      { kind: 'rect', x: 1, y: 1, width: 1, height: 1 },
      { kind: 'end' },
    ])
    expect(backend.frames[1]).toEqual([
      { kind: 'begin', ...view },
      { kind: 'circle', x: 2, y: 2, radius: 2 },
      { kind: 'text', x: 3, y: 3, text: 'second frame' },
      { kind: 'end' },
    ])
  })

  it('clear() empties the log and allows reuse', () => {
    const backend = createNullBackend()

    backend.beginFrame(view)
    backend.drawRect({ x: 0, y: 0, width: 1, height: 1 })
    backend.endFrame()
    expect(backend.frames).toHaveLength(1)

    backend.clear()
    expect(backend.frames).toEqual([])

    backend.beginFrame(view)
    backend.endFrame()
    expect(backend.frames).toEqual([[{ kind: 'begin', ...view }, { kind: 'end' }]])
  })

  it('clear() discards an open, half-recorded frame too', () => {
    const backend = createNullBackend()
    backend.beginFrame(view)
    backend.drawRect({ x: 0, y: 0, width: 1, height: 1 })

    backend.clear()
    expect(backend.frames).toEqual([])

    // The open frame is gone: drawing again without beginFrame must throw.
    expect(() => backend.drawText({ x: 0, y: 0, text: 'orphan' })).toThrow(/outside a frame/)
  })

  it('enforces the frame sandwich: draws outside a frame, double begin, and stray end all throw', () => {
    const backend = createNullBackend()

    expect(() => backend.drawRect({ x: 0, y: 0, width: 1, height: 1 })).toThrow(/outside a frame/)
    expect(() => backend.endFrame()).toThrow(/without a matching beginFrame/)

    backend.beginFrame(view)
    expect(() => backend.beginFrame(view)).toThrow(/already open/)
    backend.endFrame()
    expect(() => backend.endFrame()).toThrow(/without a matching beginFrame/)
  })

  it('records identical command sequences identically (the property replay hashing relies on)', () => {
    const draw = (b: ReturnType<typeof createNullBackend>): void => {
      b.beginFrame({ width: 320, height: 240, dpr: 2, background: '#000' })
      b.drawPolyline({ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], stroke: '#fff', lineWidth: 1.5 })
      b.drawCircle({ x: 160, y: 120, radius: 12, fill: '#ff0' })
      b.endFrame()
    }

    const a = createNullBackend()
    const b = createNullBackend()
    draw(a)
    draw(b)

    expect(a.frames).toEqual(b.frames)
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames))
  })
})
