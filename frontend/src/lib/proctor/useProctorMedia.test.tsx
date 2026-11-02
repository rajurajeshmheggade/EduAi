import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectAllOff, installMediaEnv, type MediaEnv } from '@/test/fakeMedia'
import { useProctorMedia } from './useProctorMedia'

let env: MediaEnv
beforeEach(() => { env = installMediaEnv() })
afterEach(() => { env.restore() })

function Page() {
  const media = useProctorMedia()
  return (
    <div>
      <p>{media.closed ? 'CLOSED' : 'OPEN'}</p>
      <button onClick={() => void media.startCamera().then(() => media.startMic())}>CHECK</button>
    </div>
  )
}

describe('useProctorMedia', () => {
  it.each([false, true])('owns the media of the page and switches it off on unmount (StrictMode: %s)', async (strict) => {
    const view = render(strict ? <StrictMode><Page /></StrictMode> : <Page />)
    await act(async () => {})                                            // StrictMode's test unmount replaced the stopped one
    expect(screen.getByText('OPEN')).toBeInTheDocument()
    fireEvent.click(screen.getByText('CHECK'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(env.live()).toHaveLength(2)
    view.unmount()
    expectAllOff(env)
    expect(env.audioContexts).toHaveLength(1)
  })
})
