import { describe, expect, it, vi } from 'vitest'
import {
  ConsoleFailureReporterAdapter,
  ElectronFailureReporterAdapter,
  RecordingFailureReporterAdapter,
  createFailureReport,
  reportFailure,
} from './failureReporting'
import type { FailureDecision, FailurePhase, FailureSeverity } from './failureReporting'

describe('Electron Failure Reporting Module seam', () => {
  it.each<{ phase: FailurePhase; severity: FailureSeverity; decision: FailureDecision; userMessage: string; remediation: string }>([
    { phase: 'boot:sidecar-resolution', severity: 'warning', decision: 'continue', userMessage: 'Sidecar is unavailable.', remediation: 'Run pnpm electron:dev to build the sidecar.' },
    { phase: 'boot:sidecar-health', severity: 'fatal', decision: 'quit', userMessage: 'OpenForge backend did not become ready.', remediation: 'Stop stale OpenForge processes and launch again.' },
    { phase: 'boot:event-stream', severity: 'error', decision: 'quit', userMessage: 'OpenForge event stream did not connect.', remediation: 'Restart OpenForge.' },
    { phase: 'boot:renderer-load', severity: 'fatal', decision: 'quit', userMessage: 'OpenForge window could not load.', remediation: 'Rebuild Electron assets and launch again.' },
    { phase: 'dev:port-check', severity: 'error', decision: 'quit', userMessage: 'A required development port is already in use.', remediation: 'Stop the conflicting process or choose a free port.' },
    { phase: 'install:stale-sidecar-cleanup', severity: 'warning', decision: 'continue', userMessage: 'A stale sidecar was found during install.', remediation: 'The installer will try to stop it before replacing the app.' },
    { phase: 'shutdown:cleanup', severity: 'error', decision: 'quit', userMessage: 'Shutdown cleanup did not complete cleanly.', remediation: 'Check logs for sidecar cleanup failures.' },
  ])('normalizes structured report for $phase', (input) => {
    const report = createFailureReport({
      ...input,
      cause: new Error(`${input.phase} cause`),
      now: () => new Date('2026-05-15T00:00:00.000Z'),
    })

    expect(report).toMatchObject({
      phase: input.phase,
      severity: input.severity,
      cause: { message: `${input.phase} cause` },
      userMessage: input.userMessage,
      remediation: input.remediation,
      decision: input.decision,
      occurredAt: '2026-05-15T00:00:00.000Z',
    })
  })

  it('gives callers a RecordingFailureReporterAdapter for table-driven lifecycle tests', async () => {
    const reporter = new RecordingFailureReporterAdapter()
    const report = createFailureReport({
      phase: 'boot:sidecar-health',
      severity: 'fatal',
      cause: 'timed out',
      userMessage: 'OpenForge backend did not become ready.',
      remediation: 'Stop stale OpenForge processes and launch again.',
      decision: 'quit',
    })

    await expect(reportFailure(reporter, report)).resolves.toBe('quit')

    expect(reporter.reports).toEqual([report])
  })

  it('maps ConsoleFailureReporterAdapter severity to the narrow logger Interface', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const reporter = new ConsoleFailureReporterAdapter(logger)

    await reportFailure(reporter, createFailureReport({
      phase: 'dev:port-check',
      severity: 'error',
      cause: 'port occupied',
      userMessage: 'A required development port is already in use.',
      remediation: 'Stop the conflicting process or choose a free port.',
      decision: 'quit',
      now: () => new Date('2026-05-15T00:00:00.000Z'),
    }))

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[electron:failure] error dev:port-check'))
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Remediation: Stop the conflicting process or choose a free port.'))
  })

  it('keeps ElectronFailureReporterAdapter concrete Electron behavior behind the same seam', async () => {
    const consoleReporter = new RecordingFailureReporterAdapter()
    const showErrorBox = vi.fn()
    const onQuitDecision = vi.fn()
    const reporter = new ElectronFailureReporterAdapter({ consoleReporter, showErrorBox, onQuitDecision })
    const report = createFailureReport({
      phase: 'boot:renderer-load',
      severity: 'fatal',
      cause: 'load failed',
      userMessage: 'OpenForge window could not load.',
      remediation: 'Rebuild Electron assets and launch again.',
      decision: 'quit',
    })

    await expect(reportFailure(reporter, report)).resolves.toBe('quit')

    expect(consoleReporter.reports).toEqual([report])
    expect(showErrorBox).toHaveBeenCalledWith('OpenForge failed to start', expect.stringContaining('OpenForge window could not load.'))
    expect(onQuitDecision).toHaveBeenCalledWith(report)
  })
})
