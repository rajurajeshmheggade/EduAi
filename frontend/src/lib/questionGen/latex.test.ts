import { latexToText, parseLatex } from './latex'

describe('LaTeX reader', () => {
  it('linearises school maths to readable Unicode', () => {
    expect(latexToText('x^2 + 2x + 1 = 0')).toBe('x² + 2x + 1 = 0')
    expect(latexToText('\\frac{a}{b}')).toBe('a/b')
    expect(latexToText('\\frac{a+b}{c}')).toBe('(a+b)/c')
    expect(latexToText('H_2O')).toBe('H₂O')
    expect(latexToText('\\sqrt{b^2-4ac}')).toBe('√(b²-4ac)')
    expect(latexToText('\\sqrt[3]{x}')).toBe('∛x')
    expect(latexToText('E = mc^{2}')).toBe('E = mc²')
    expect(latexToText('x_{n+1}')).toBe('xₙ₊₁')
    expect(latexToText('\\alpha \\leq 30^\\circ')).toBe('α ≤ 30°')
    expect(latexToText('\\text{speed} = \\frac{d}{t}')).toBe('speed = d/t')
    expect(latexToText('10^{-3}')).toBe('10⁻³')
    expect(latexToText('\\vec{F} = m\\vec{a}')).toBe('F⃗ = ma⃗')
    expect(latexToText('\\left( x \\right)')).toBe('( x )')
  })

  it('builds an AST with fractions, radicals and scripts', () => {
    const [frac] = parseLatex('\\frac{1}{2}')
    expect(frac).toEqual({ kind: 'frac', num: [{ kind: 'text', value: '1' }], den: [{ kind: 'text', value: '2' }] })
    const nodes = parseLatex('x_i^2')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'script', base: [{ kind: 'text', value: 'x' }], sub: [{ kind: 'text', value: 'i' }], sup: [{ kind: 'text', value: '2' }] })
    expect(parseLatex('\\sqrt[3]{8}')[0]).toMatchObject({ kind: 'sqrt', index: [{ kind: 'text', value: '3' }] })
  })

  it('never throws on malformed input', () => {
    for (const bad of ['\\frac{', '}}}', '^', '_{', '\\sqrt[', '\\unknowncmd{x}', '{'.repeat(200), '']) {
      expect(() => latexToText(bad)).not.toThrow()
      expect(() => parseLatex(bad)).not.toThrow()
    }
    expect(latexToText('\\unknowncmd')).toBe('unknowncmd')
  })
})
