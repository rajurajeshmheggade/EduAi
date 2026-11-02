import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectAllOff, installMediaEnv, type MediaEnv } from '@/test/fakeMedia'
import { isMediaClosed, ProctorMedia, ScreenSurfaceError } from './media'
import { MediaRegistry } from './mediaRegistry'

let env: MediaEnv
beforeEach(() => { env = installMediaEnv() })
afterEach(() => { env.restore() })

describe('ProctorMedia teardown', () => {
  it('stop() switches off every camera, microphone and screen track exactly once, the worker and the audio analyser', async () => {
    const media = new ProctorMedia()
    await media.startCamera()
    await media.startMic()
    await media.startScreen()
    await media.loadModels({ embed: false, objects: false })
    expect(media.cameraLive() && media.micLive() && media.screenLive() && media.modelsReady).toBe(true)

    media.stop()
    media.stop()                                                          // idempotent: nothing is stopped twice
    expectAllOff(env)
    expect(env.tracks).toHaveLength(3)
    expect(env.workers).toHaveLength(1)
    expect(env.audioContexts).toHaveLength(1)
    expect([media.camera, media.mic, media.screen, media.camVideo.srcObject, media.screenVideo.srcObject]).toEqual([null, null, null, null, null])
    expect(media.closed && !media.modelsReady && !media.cameraLive()).toBe(true)
  })

  it('switching camera stops the previous one at once, and only the current one is left to stop', async () => {
    const media = new ProctorMedia()
    await media.startCamera()
    const [first] = env.tracks
    await media.startCamera('cam-b')
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(env.live().map((t) => t.label)).toEqual(['USB Camera'])
    expect(media.cameraDeviceId()).toBe('cam-b')
    await media.startCamera('cam-b')                                      // the same camera again: nothing reopened
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)
    media.stop()
    expectAllOff(env)
  })

  it('two camera requests at once (device picker + unplug, double click) never leave a second camera running', async () => {
    const media = new ProctorMedia()
    await Promise.all([media.startCamera('cam-a'), media.startCamera('cam-b'), media.startCamera('cam-a')])
    expect(env.live()).toHaveLength(1)
    expect(env.live()[0].label).toBe('Integrated Camera')
    media.stop()
    expectAllOff(env)
  })

  it('a camera whose permission prompt is answered after the exam ended is stopped the moment it arrives', async () => {
    const media = new ProctorMedia()
    const prompt = env.holdNext()
    const starting = media.startCamera()
    await Promise.resolve()
    media.stop()                                                          // the student left while the prompt was open
    prompt.release()
    await expect(starting).rejects.toSatisfy(isMediaClosed)
    expect(env.tracks).toHaveLength(1)
    expectAllOff(env)
    expect(media.camera).toBeNull()
  })

  it('a stopped ProctorMedia opens nothing again (late steps of an abandoned device check)', async () => {
    const media = new ProctorMedia()
    media.stop()
    for (const late of [media.startCamera(), media.startMic(), media.startScreen(), media.loadModels({ embed: false, objects: false })]) {
      await expect(late).rejects.toSatisfy(isMediaClosed)
    }
    expect(env.getUserMedia).not.toHaveBeenCalled()
    expect(env.getDisplayMedia).not.toHaveBeenCalled()
    expect(env.workers).toEqual([])
    expect(await media.analyse()).toBeNull()
  })

  it('stopping while the models load ends the load and terminates the worker once', async () => {
    const media = new ProctorMedia()
    const loading = media.loadModels({ embed: false, objects: false })
    media.stop()
    await expect(loading).rejects.toSatisfy(isMediaClosed)
    expect(env.workers).toHaveLength(1)
    expect(env.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(media.modelsReady).toBe(false)
  })

  it('switching microphone closes the previous analyser; a refused screen share is stopped exactly once', async () => {
    const media = new ProctorMedia()
    await media.startMic()
    await media.startMic('mic-b')
    expect(env.audioContexts[0].close).toHaveBeenCalledTimes(1)
    expect(env.tracks[0].stop).toHaveBeenCalledTimes(1)
    media.stop()
    expectAllOff(env)

    env.restore()
    env = installMediaEnv({ screenSurface: 'browser' })
    const other = new ProctorMedia()
    await expect(other.startScreen()).rejects.toBeInstanceOf(ScreenSurfaceError)
    expect(env.tracks[0].stop).toHaveBeenCalledTimes(1)
    other.stop()
    expectAllOff(env)
  })
})

describe('MediaRegistry', () => {
  it('stops each stream it handed out once, and nothing it did not', async () => {
    const reg = new MediaRegistry()
    const a = await reg.acquire(() => navigator.mediaDevices.getUserMedia({ video: true }))
    await reg.acquire(() => navigator.mediaDevices.getUserMedia({ audio: true }))
    reg.release(a)
    reg.release(a)
    expect(reg.size).toBe(1)
    reg.closeAll()
    reg.closeAll()
    expectAllOff(env)
    await expect(reg.acquire(() => navigator.mediaDevices.getUserMedia({ video: true }))).rejects.toSatisfy(isMediaClosed)
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)
  })
})
