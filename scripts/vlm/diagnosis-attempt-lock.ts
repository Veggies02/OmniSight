import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

interface LockOwner {
  pid: number;
  hostname: string;
  token: string;
}

export interface DiagnosisLock {
  attemptId: string;
  assertOwned(): void;
  release(): void;
}

/** Atomic mkdir provides a cross-process, cross-platform exclusive lock. */
export function acquireDiagnosisLock(outputDirectory: string): DiagnosisLock {
  const resolvedOutput = path.resolve(outputDirectory);
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const lockPath = path.join(resolvedOutput, ".diagnosis-lock");
  const owner: LockOwner = { pid: process.pid, hostname: os.hostname(), token: crypto.randomUUID() };
  const attemptId = `attempt-${Date.now()}-${crypto.randomUUID()}`;

  try {
    fs.mkdirSync(lockPath);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    if (reclaimDeadLocalLock(lockPath)) {
      try {
        fs.mkdirSync(lockPath);
      } catch (retryError: any) {
        if (retryError?.code !== "EEXIST") throw retryError;
        throw lockConflict(lockPath);
      }
    } else {
      throw lockConflict(lockPath);
    }
  }

  try {
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify(owner), { flag: "wx" });
  } catch (error) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }

  let released = false;
  const assertOwned = () => {
    if (released) throw new Error("Diagnosis lock has already been released.");
    let current: LockOwner;
    try {
      current = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
    } catch {
      throw new Error("Diagnosis lock ownership could not be verified; refusing publication.");
    }
    if (current.token !== owner.token || current.pid !== owner.pid || current.hostname !== owner.hostname) {
      throw new Error("Diagnosis lock ownership changed; refusing publication.");
    }
  };
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    try {
      const current: LockOwner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
      if (current.token === owner.token && current.pid === owner.pid && current.hostname === owner.hostname) {
        fs.rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {
      // A changed or unreadable lock is left for explicit recovery; never remove another owner's lock.
    }
  };

  process.once("exit", release);
  return { attemptId, assertOwned, release };
}

function reclaimDeadLocalLock(lockPath: string): boolean {
  let owner: LockOwner;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    // Missing/corrupt owner or a lock from another host is never stolen automatically.
    return false;
  }
  if (owner.hostname !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error: any) {
    if (error?.code !== "ESRCH") return false;
  }

  const tombstone = `${lockPath}.stale-${crypto.randomUUID()}`;
  try {
    fs.renameSync(lockPath, tombstone);
    fs.rmSync(tombstone, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function lockConflict(lockPath: string): Error {
  return new Error(`Diagnosis attempt lock is held or requires manual recovery: '${lockPath}'.`);
}
