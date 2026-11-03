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
   * with strict validation to prevent shell injection, path traversal,
   * or illegal git ref syntax.
   *
   * Enforces:
   * - Must be a non-empty string.
   * - Length between 1 and 128 characters.
   * - First character must be alphanumeric ([a-zA-Z0-9]).
   * - Remaining characters must be alphanumeric, hyphen, or underscore ([a-zA-Z0-9_-]).
   * - Rejects path traversal (..), slashes (/ or \), and whitespace.
   */
  public validateJobId(jobId: any): string {
    if (typeof jobId !== 'string') {
      throw new Error(`Invalid jobId: must be a non-empty string, received ${typeof jobId}.`);
    }
    if (!jobId || jobId.length === 0) {
      throw new Error('Invalid jobId: cannot be empty.');
    }
    if (jobId.length > 128) {
      throw new Error(`Invalid jobId: exceeds maximum allowed length of 128 characters (length: ${jobId.length}).`);
    }
    if (/\s/.test(jobId)) {
      throw new Error(`Invalid jobId: "${jobId}". Whitespace characters are not permitted.`);
    }
    if (jobId.includes('/') || jobId.includes('\\') || jobId.includes('..')) {
      throw new Error(`Invalid jobId: "${jobId}". Path traversal characters and slashes are strictly prohibited.`);
    }
    const JOB_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
    if (!JOB_ID_REGEX.test(jobId)) {
      throw new Error(
        `Invalid jobId: "${jobId}". Must start with an alphanumeric character and contain only alphanumeric characters, dashes, and underscores (1-128 chars).`
      );
    }
    return jobId;
  }

  /**
   * Backward-compatible alias for validateJobId.
   */
  public sanitizeJobId(jobId: string): string {
    return this.validateJobId(jobId);
  }

  /**
   * Checks whether a local Git branch exists using git show-ref --verify.
   */
  public async checkBranchExists(branchName: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
        cwd: this.repoRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks whether a worktree directory already exists on the filesystem.
   */
  public checkWorktreeDirectoryExists(worktreePath: string): boolean {
    return fs.existsSync(worktreePath);
  }

  /**
   * Checks whether a worktree path is already registered with git.
   */
  public async checkWorktreeRegistered(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.repoRoot,
      });
      const resolvedTarget = path.resolve(worktreePath);
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const registeredPath = path.resolve(line.slice(9).trim());
          if (registeredPath === resolvedTarget) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
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
   * Strictly validates job ID and verifies no conflicting branch, directory,
   * or git worktree registration exists before creating.
   */
  public async createWorktree(jobId: string, baseCommit?: string): Promise<WorktreeInfo> {
    const cleanJobId = this.validateJobId(jobId);
    const branchName = `omnisight-repair/${cleanJobId}`;
    const worktreePath = path.join(this.worktreeBaseDir, cleanJobId);

    // Pre-flight check: ensure no duplicate branch, worktree directory, or git registration exists
    const conflicts: string[] = [];
    if (await this.checkBranchExists(branchName)) {
      conflicts.push(`branch "refs/heads/${branchName}" already exists`);
    }
    if (this.checkWorktreeDirectoryExists(worktreePath)) {
      conflicts.push(`worktree directory already exists on disk at "${worktreePath}"`);
    }
    if (await this.checkWorktreeRegistered(worktreePath)) {
      conflicts.push(`worktree is already registered in git at "${worktreePath}"`);
    }
    if (conflicts.length > 0) {
      throw new Error(
        `Cannot create repair worktree: resource conflict detected for job ID "${cleanJobId}". ${conflicts.join(
          '; '
        )}. Existing repair resources will not be overwritten or deleted.`
      );
    }

    // Ensure the base directory exists
    if (!fs.existsSync(this.worktreeBaseDir)) {
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
    }

    const commitToUse = baseCommit || (await this.getHeadCommit());
    const commitValid = await this.verifyCommitExists(commitToUse);
    if (!commitValid) {
      throw new Error(`Base commit ref "${commitToUse}" could not be verified in git repository.`);
    }

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
   * If options.preserveBranch is true, removes the worktree folder and prunes records, but preserves the git branch.
   */
  public async cleanupWorktree(
    jobId: string,
    options: { preserveBranch?: boolean } = {}
  ): Promise<{ worktreeRemoved: boolean; branchRemoved: boolean; branchPreserved: boolean; notes?: string }> {
    const cleanJobId = this.sanitizeJobId(jobId);
    const branchName = `omnisight-repair/${cleanJobId}`;
    const worktreePath = path.join(this.worktreeBaseDir, cleanJobId);

    let worktreeRemoved = false;
    let branchRemoved = false;
    let branchPreserved = false;
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

    // 2. Branch removal or preservation
    if (options.preserveBranch) {
      branchPreserved = true;
      branchRemoved = false;
    } else {
      try {
        await execFileAsync('git', ['branch', '-D', branchName], {
          cwd: this.repoRoot,
        });
        branchRemoved = true;
      } catch (branchErr: any) {
        // Branch might already be deleted or not exist
        branchRemoved = false;
      }
      branchPreserved = false;
    }

    return {
      worktreeRemoved,
      branchRemoved,
      branchPreserved,
      notes: notes.length > 0 ? notes.join('; ') : undefined,
    };
  }

  /**
   * Stages approved files and creates a Git commit inside the isolated worktree directory.
   * Configures author and committer metadata securely without modifying global git config.
   */
  public async commitChanges(
    worktreePath: string,
    message: string,
    files: string[] = []
  ): Promise<{ commitSha: string; commitMessage: string; filesCommitted: string[] }> {
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Cannot commit changes: Worktree path does not exist: ${worktreePath}`);
    }

    // Check status in worktree
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
    });
    const modifiedLines = statusResult.stdout.trim().split('\n').filter(Boolean);
    if (modifiedLines.length === 0) {
      throw new Error('Cannot commit changes: Working tree has no unstaged or staged changes.');
    }

    // Stage files
    if (files.length > 0) {
      await execFileAsync('git', ['add', '--', ...files], {
        cwd: worktreePath,
      });
    } else {
      await execFileAsync('git', ['add', '-A'], {
        cwd: worktreePath,
      });
    }

    // Verify files were staged
    const stagedCheck = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath,
    });
    const stagedFiles = stagedCheck.stdout.trim().split('\n').filter(Boolean);
    if (stagedFiles.length === 0) {
      throw new Error('Cannot commit changes: No changes were staged.');
    }

    // Commit using safe argument array and explicit user config
    const commitArgs = [
      '-c',
      'user.name=OmniSight Repair Agent',
      '-c',
      'user.email=repair-agent@omnisight.ai',
      'commit',
      '-m',
      message,
    ];

    await execFileAsync('git', commitArgs, {
      cwd: worktreePath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'OmniSight Repair Agent',
        GIT_AUTHOR_EMAIL: 'repair-agent@omnisight.ai',
        GIT_COMMITTER_NAME: 'OmniSight Repair Agent',
        GIT_COMMITTER_EMAIL: 'repair-agent@omnisight.ai',
      },
    });

    // Retrieve commit SHA
    const revParseResult = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
    });
    const commitSha = revParseResult.stdout.trim();

    return {
      commitSha,
      commitMessage: message,
      filesCommitted: stagedFiles,
    };
  }

  /**
   * Resolves the commit SHA of a given branch name.
   */
  public async getBranchCommit(branchName: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', branchName], {
      cwd: this.repoRoot,
    });
    return stdout.trim();
  }
}
