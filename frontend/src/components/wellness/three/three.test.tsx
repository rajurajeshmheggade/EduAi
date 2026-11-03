import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DimensionalAnalysisVisualizer from './DimensionalAnalysisVisualizer'
import ThreeDimensionalParticles from './ThreeDimensionalParticles'

// jsdom has no WebGL: both visuals must degrade to their DOM chrome without throwing
describe('three visuals without WebGL', () => {
  it('renders the analysis card states', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender, unmount } = render(<DimensionalAnalysisVisualizer isAnalyzing={false} />)
    expect(screen.getByText('Quantum Emotion Matrix (3D)')).toBeInTheDocument()
    expect(screen.getByText('Interactive 3D')).toBeInTheDocument()

    rerender(<DimensionalAnalysisVisualizer isAnalyzing analysisResult={null} compact />)
    expect(screen.getByText('Dimensional Particle Analyzer')).toBeInTheDocument()
    expect(screen.getByText('Vectorizing cognitive reflection...')).toBeInTheDocument()

    rerender(
      <DimensionalAnalysisVisualizer
        isAnalyzing={false}
        analysisResult={{ mood_score: 72, primary_emotions: [], triggers: [], analysis_summary: '', coping_strategies: [], milestone_encouragement: '' }}
      />,
    )
    expect(screen.getByText('Aura Score: 72/100')).toBeInTheDocument()
    unmount()
  })

  it('mounts and unmounts the background particles', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container, unmount } = render(<ThreeDimensionalParticles isAnalyzing={false} stressLevel={50} activeMode="nebula" />)
    expect(container.firstChild).toHaveClass('absolute', 'inset-0')
    unmount()
  })
})
