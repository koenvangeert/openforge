export type FailurePhase =
  | 'boot:sidecar-resolution'
  | 'boot:sidecar-health'
  | 'boot:event-stream'
  | 'boot:renderer-load'
  | 'boot:main'
  | 'runtime:event-stream'
  | 'dev:port-check'
  | 'install:stale-sidecar-cleanup'
  | 'shutdown:cleanup'

export type FailureSeverity = 'info' | 'warning' | 'error' | 'fatal'
export type FailureDecision = 'continue' | 'retry' | 'quit'

export interface FailureCause {
  message: string
  name?: string
  stack?: string
}

export interface ElectronFailureReport {
  phase: FailurePhase
  severity: FailureSeverity
  cause: FailureCause
  userMessage: string
  remediation: string
  decision: FailureDecision
  occurredAt: string
}

export interface FailureReportInput {
  phase: FailurePhase
  severity: FailureSeverity
  cause: unknown
  userMessage: string
  remediation: string
  decision: FailureDecision
  now?: () => Date
}

/** Failure Reporting Module Interface seam: high Leverage and Locality for launch/runtime failure policy. */
export interface ElectronFailureReporter {
  reportFailure(report: ElectronFailureReport): FailureDecision | Promise<FailureDecision>
}

export interface FailureLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

function causeFromUnknown(cause: unknown): FailureCause {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      name: cause.name,
      stack: cause.stack,
    }
  }

  return { message: String(cause) }
}

export function createFailureReport(input: FailureReportInput): ElectronFailureReport {
  return {
    phase: input.phase,
    severity: input.severity,
    cause: causeFromUnknown(input.cause),
    userMessage: input.userMessage,
    remediation: input.remediation,
    decision: input.decision,
    occurredAt: (input.now ?? (() => new Date()))().toISOString(),
  }
}

export async function reportFailure(
  reporter: ElectronFailureReporter | null | undefined,
  report: ElectronFailureReport,
): Promise<FailureDecision> {
  if (!reporter) return report.decision
  return reporter.reportFailure(report)
}

function formatFailureReport(report: ElectronFailureReport): string[] {
  return [
    `[electron:failure] ${report.severity} ${report.phase}: ${report.userMessage}`,
    `Cause: ${report.cause.message}`,
    `Remediation: ${report.remediation}`,
    `Decision: ${report.decision}`,
  ]
}

export class ConsoleFailureReporterAdapter implements ElectronFailureReporter {
  private readonly logger: FailureLogger

  constructor(logger: FailureLogger = console) {
    this.logger = logger
  }

  reportFailure(report: ElectronFailureReport): FailureDecision {
    const write = report.severity === 'fatal' || report.severity === 'error'
      ? this.logger.error.bind(this.logger)
      : report.severity === 'warning'
        ? this.logger.warn.bind(this.logger)
        : this.logger.info.bind(this.logger)

    for (const line of formatFailureReport(report)) write(line)
    return report.decision
  }
}

export class RecordingFailureReporterAdapter implements ElectronFailureReporter {
  readonly reports: ElectronFailureReport[] = []

  reportFailure(report: ElectronFailureReport): FailureDecision {
    this.reports.push(report)
    return report.decision
  }
}

export interface ElectronFailureReporterAdapterOptions {
  consoleReporter?: ElectronFailureReporter
  showErrorBox?: (title: string, content: string) => void
  onQuitDecision?: (report: ElectronFailureReport) => void
}

export class ElectronFailureReporterAdapter implements ElectronFailureReporter {
  private readonly consoleReporter: ElectronFailureReporter
  private readonly showErrorBox?: (title: string, content: string) => void
  private readonly onQuitDecision?: (report: ElectronFailureReport) => void

  constructor(options: ElectronFailureReporterAdapterOptions = {}) {
    this.consoleReporter = options.consoleReporter ?? new ConsoleFailureReporterAdapter()
    this.showErrorBox = options.showErrorBox
    this.onQuitDecision = options.onQuitDecision
  }

  async reportFailure(report: ElectronFailureReport): Promise<FailureDecision> {
    await this.consoleReporter.reportFailure(report)

    if (report.severity === 'fatal' || report.decision === 'quit') {
      this.showErrorBox?.('OpenForge failed to start', `${report.userMessage}\n\n${report.remediation}\n\nCause: ${report.cause.message}`)
    }

    if (report.decision === 'quit') {
      this.onQuitDecision?.(report)
    }

    return report.decision
  }
}
