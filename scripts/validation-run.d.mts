export type Target = { ref: string; url: string; publicKey: string; secretKey: string };
export type Account = {
  key: 'A' | 'B' | 'C' | 'D';
  workspace: 'X' | 'Y' | null;
  role: 'admin' | 'member' | null;
  id: string;
  email: string;
  password: string;
  name: string;
};
export type Run = { runId: string; workspaces: Record<'X' | 'Y', { id: string; name: string }>; accounts: Account[] };
export function readTarget(): Target;
export function createRun(target: Target): Promise<Run>;
export function trackUser(runId: string, userId: string): Promise<void>;
export function cleanupRun(target: Target, runId: string): Promise<unknown>;
export function cleanupPending(target: Target): Promise<string[]>;
