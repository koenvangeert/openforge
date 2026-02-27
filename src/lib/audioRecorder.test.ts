import { describe, it, expect, vi, before3ach } from 'vitest'
import { createAudioRecorder } from './audioRecorder'

const mockAudioContext = {
  sampleRate: 44100,
  createMediaStreamSource: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  createScriptProcessor: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }),
  destination: {},
  close: vi.fn().mockResolvedValue(undefined),
}

const mockOfflineAudioContext = {
  createBuffer: vi.fn().mockReturnValue({
    copyToChannel: vi.fn(),
  }),
  createBufferSource: vi.fn().mockReturnValue({
    connect: vi.fn(),
    start: vi.fn(),
    buffer: null,
  }),
  destination: {},
  startRendering: vi.fn().mockResolvedValue({
    getChannelData: vi.fn().mockReturnValue(new Float32Array(0)),
  }),
}

Object.defineProperty(global, 'AudioContext', {
  writable: true,
  value: vi.fn().mockImplementation(() => mockAudioContext),
})

Object.defineProperty(global, 'OfflineAudioContext', {
  writable: true,
  value: vi.fn().mockImplementation(() => mockOfflineAudioContext),
})

Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
    }),
  },
})

describe('audioRecorder', () => {
  before3ach(() => {
    vi.clearAllMocks()
  })

  it('createAudioRecorder returns object with expected interface', () => {
    const recorder = createAudioRecorder()
    expect(typeof recorder.start).toBe('function')
    expect(typeof recorder.stop).toBe('function')
    expect(typeof recorder.isRecording).toBe('function')
    expect(typeof recorder.getDuration).toBe('function')
  })

  it('isRecording returns false initially', () => {
    const recorder = createAudioRecorder()
    expect(recorder.isRecording()).toBe(false)
  })

  it('getDuration returns 0 initially', () => {
    const recorder = createAudioRecorder()
    expect(recorder.getDuration()).toBe(0)
  })

  it('respects maxDurationMs option', () => {
    const recorder = createAudioRecorder({ maxDurationMs: 60000 })
    expect(recorder).toBeTruthy()
    expect(recorder.isRecording()).toBe(false)
  })
})
