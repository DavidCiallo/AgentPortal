/** Stub for removed swarm/teamHelpers.ts */
export function getTeammateName(): string | undefined { return undefined }
export function getTeamLeadName(): string | undefined { return undefined }
export function getTeamName(): string | undefined { return undefined }
export function isTeammate(): boolean { return false }

export function readTeamFile(): unknown[] {
  return []
}

export async function readTeamFileAsync(): Promise<unknown[]> {
  return []
}

export function removeTeammateFromTeamFile(): void {}

export function setMemberActive(): void {}

export function syncTeammateMode(): void {}

export function getTeamFilePath(_teamName: string): string {
  return ''
}

export function registerTeamForSessionCleanup(): void {}

export function sanitizeAgentName(name: string): string {
  return name
}

export function sanitizeName(name: string): string {
  return name
}

export async function writeTeamFileAsync(): Promise<void> {}
