import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseCommit: string;
}

export class WorktreeManager {
  private repoRoot: string;
  private worktreeBaseDir: string;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreeBaseDir = path.join(this.repoRoot, 'artifacts', 'repair-worktrees');
  }

  /**
   * Validates git identifier format (job-id, branch name, commit sha)
   * to strictly prevent shell injection or illegal git ref syntax.
   */
  public sanitizeJobId(jobId: string): string {
    const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized || sanitized.length === 0) {
      throw new Error(`Invalid jobId: "${jobId}". Must contain only alphanumeric, dash, or underscore.`);
    }
    return sanitized;
  }

  /**
   * Verifies that a commit or ref exists in the repository.
   */
  public async verifyCommitExists(commitRef: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', commitRef], {
        cwd: this.repoRoot,
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the current HEAD commit SHA of the repository.
   */
  public async getHeadCommit(): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: this.repoRoot,
    });
    return stdout.trim();
  }

  /**
   * Creates an isolated worktree for the given job.
   */
  public async createWorktree(jobId: string, baseCommit?: string): Promise<WorktreeInfo> {
    const cleanJobId = this.sanitizeJobId(jobId);
    const branchName = `omnisight-repair/${cleanJobId}`;
    const worktreePath = path.join(this.worktreeBaseDir, cleanJobId);

    // Ensure the base directory exists
    if (!fs.existsSync(this.worktreeBaseDir)) {
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
    }

    const commitToUse = baseCommit || (await this.getHeadCommit());
    const commitValid = await this.verifyCommitExists(commitToUse);
    if (!commitValid) {
      throw new Error(`Base commit ref "${commitToUse}" could not be verified in git repository.`);
    }

    // Check if worktree or branch already exists and clean if necessary
    await this.cleanupWorktree(cleanJobId).catch(() => {});

    // Create the isolated worktree with git worktree add -b <branch> <path> <commit>
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, commitToUse], {
        cwd: this.repoRoot,
      });
    } catch (err: any) {
      throw new Error(`Failed to create isolated git worktree: ${err?.message || String(err)}`);
    }

    return {
      worktreePath,
      branchName,
      baseCommit: commitToUse,
    };
  }

  /**
   * Safely cleans up the repair worktree and branch.
   * Only targets paths inside artifacts/repair-worktrees/ and branches starting with omnisight-repair/.
   * Idempotent: safely handles already-removed worktrees or non-existent branches.
   */
  public async cleanupWorktree(jobId: string): Promise<{ worktreeRemoved: boolean; branchRemoved: boolean; notes?: string }> {
    const cleanJobId = this.sanitizeJobId(jobId);
    const branchName = `omnisight-repair/${cleanJobId}`;
    const worktreePath = path.join(this.worktreeBaseDir, cleanJobId);

    let worktreeRemoved = false;
    let branchRemoved = false;
    const notes: string[] = [];

    // Safety guard: ensure worktree path is strictly inside repair-worktrees directory
    if (!worktreePath.startsWith(this.worktreeBaseDir) || worktreePath === this.worktreeBaseDir) {
      throw new Error(`Illegal worktree deletion path: ${worktreePath}`);
    }

    // If worktree directory does not exist on disk, it is already removed
    if (!fs.existsSync(worktreePath)) {
      worktreeRemoved = true;
    } else {
      // 1. Remove the worktree via git worktree remove
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: this.repoRoot,
        });
        worktreeRemoved = true;
      } catch (gitErr: any) {
        notes.push(`git worktree remove warning: ${gitErr?.message || String(gitErr)}`);
        // If git worktree command failed (e.g. dir manually modified, locked or unindexed), attempt filesystem removal
        if (fs.existsSync(worktreePath)) {
          try {
            // First unlink node_modules junction/symlink if present to prevent recursive locking issues on Windows
            const nodeModulesPath = path.join(worktreePath, 'node_modules');
            if (fs.existsSync(nodeModulesPath)) {
              try {
                fs.rmSync(nodeModulesPath, { recursive: true, force: true });
              } catch {
                // Ignore if cannot remove junction individually
              }
            }
            fs.rmSync(worktreePath, { recursive: true, force: true });
            worktreeRemoved = !fs.existsSync(worktreePath);
          } catch (rmErr: any) {
            notes.push(`fs.rmSync failure: ${rmErr?.message || String(rmErr)}`);
            worktreeRemoved = false;
          }
        } else {
          worktreeRemoved = true;
        }
      }
    }

    // Prune git worktree administrative records
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: this.repoRoot });
    } catch {
      // Ignore prune errors
    }

    // 2. Remove the repair branch
    try {
      await execFileAsync('git', ['branch', '-D', branchName], {
        cwd: this.repoRoot,
      });
      branchRemoved = true;
    } catch (branchErr: any) {
      // Branch might already be deleted or not exist
      branchRemoved = false;
    }

    return {
      worktreeRemoved,
      branchRemoved,
      notes: notes.length > 0 ? notes.join('; ') : undefined,
    };
  }
}
