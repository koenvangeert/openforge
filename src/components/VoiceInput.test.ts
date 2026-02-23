import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VoiceInput from './VoiceInput.svelte'

vi.mock('../lib/ipc', () => ({
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  downloadWhisperModel: vi.fn(),
}))

vi.mock('../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

import { getWhisperModelStatus } from '../lib/ipc'

describe('VoiceInput', () => {
  const baseProps = {
    onTranscription: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders mic button in idle state', () => {
    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    expect(button).toBeTruthy()
  })

  it('shows model not downloaded message when model status returns downloaded: false', async () => {
    vi.mocked(getWhisperModelStatus).mockResolvedValue({
      downloaded: false,
      model_path: null,
      model_size_bytes: null,
      model_name: 'ggml-small.bin',
    })

    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    await fireEvent.click(button)
    await new Promise((r) => setTimeout(r, 10))

    expect(screen.getByText('Download model in Settings first')).toBeTruthy()
  })

  it('disables button when disabled prop is true', () => {
    render(VoiceInput, { props: { ...baseProps, disabled: true } })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('button has microphone SVG icon', () => {
    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    const svg = button.querySelector('svg')
    expect(svg).toBeTruthy()
  })
})
