import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { parseCaptureCliArgs, VisualEvidenceHarness } from "../scripts/capture-visual-evidence";

test.describe("Step 4.2 Capture CLI Argument Parser & Validation Tests", () => {
  test("1. returns empty options when no arguments are passed (defaults preserved)", () => {
    const options = parseCaptureCliArgs([]);
    expect(options).toEqual({});

    const harness = new VisualEvidenceHarness(options);
    expect(harness.getBaseUrl()).toBe("http://127.0.0.1:5173");
    expect(harness.getOutputDir()).toBe(path.resolve(process.cwd(), "artifacts/visual-evidence"));
    expect(harness.getRunId()).toMatch(/^run-\d{4}-\d{2}-\d{2}/);
  });

  test("2. correctly parses space-separated arguments (--flag value)", () => {
    const options = parseCaptureCliArgs([
      "--run-id",
      "job-test-456",
      "--base-url",
      "http://127.0.0.1:3000",
      "--output-dir",
      "artifacts/custom-output",
    ]);

    expect(options.runId).toBe("job-test-456");
    expect(options.baseUrl).toBe("http://127.0.0.1:3000");
    expect(options.outputDir).toBe(path.resolve(process.cwd(), "artifacts/custom-output"));

    const harness = new VisualEvidenceHarness(options);
    expect(harness.getRunId()).toBe("job-test-456");
    expect(harness.getBaseUrl()).toBe("http://127.0.0.1:3000");
    expect(harness.getOutputDir()).toBe(path.resolve(process.cwd(), "artifacts/custom-output"));
    expect(harness.getRunDirectory()).toBe(path.resolve(process.cwd(), "artifacts/custom-output/job-test-456"));
  });

  test("3. correctly parses equals-separated arguments (--flag=value)", () => {
    const options = parseCaptureCliArgs([
      "--run-id=job-equals-789",
      "--base-url=https://staging.example.com",
      "--output-dir=artifacts/nested/runs",
    ]);

    expect(options.runId).toBe("job-equals-789");
    expect(options.baseUrl).toBe("https://staging.example.com");
    expect(options.outputDir).toBe(path.resolve(process.cwd(), "artifacts/nested/runs"));

    const harness = new VisualEvidenceHarness(options);
    expect(harness.getRunId()).toBe("job-equals-789");
    expect(harness.getBaseUrl()).toBe("https://staging.example.com");
  });

  test("4. normalizes trailing slashes on base-url", () => {
    const options = parseCaptureCliArgs(["--base-url", "http://127.0.0.1:5173///"]);
    expect(options.baseUrl).toBe("http://127.0.0.1:5173");
  });

  test("5. rejects missing flag values", () => {
    expect(() => parseCaptureCliArgs(["--run-id"])).toThrow(/Missing value for --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id="])).toThrow(/Missing value for --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id", "--base-url", "http://127.0.0.1:5173"])).toThrow(/Missing value for --run-id/);
    expect(() => parseCaptureCliArgs(["--base-url"])).toThrow(/Missing value for --base-url/);
    expect(() => parseCaptureCliArgs(["--base-url="])).toThrow(/Missing value for --base-url/);
    expect(() => parseCaptureCliArgs(["--output-dir"])).toThrow(/Missing value for --output-dir/);
    expect(() => parseCaptureCliArgs(["--output-dir="])).toThrow(/Missing value for --output-dir/);
  });

  test("6. rejects unknown or unexpected flags and arguments", () => {
    expect(() => parseCaptureCliArgs(["--unknown-flag"])).toThrow(/Unknown option: '--unknown-flag'/);
    expect(() => parseCaptureCliArgs(["unexpected-positional"])).toThrow(/Unexpected argument: 'unexpected-positional'/);
  });

  test("7. rejects invalid run-id with dangerous characters or directory traversal", () => {
    expect(() => parseCaptureCliArgs(["--run-id", "../escape"])).toThrow(/Invalid --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id", "job/123"])).toThrow(/Invalid --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id", "job\\123"])).toThrow(/Invalid --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id", "job 123"])).toThrow(/Invalid --run-id/);
    expect(() => parseCaptureCliArgs(["--run-id", ""])).toThrow(/Invalid --run-id/);
  });

  test("8. rejects invalid or unsupported URLs", () => {
    expect(() => parseCaptureCliArgs(["--base-url", "not-a-url"])).toThrow(/Invalid --base-url/);
    expect(() => parseCaptureCliArgs(["--base-url", "ftp://example.com"])).toThrow(/Invalid --base-url/);
    expect(() => parseCaptureCliArgs(["--base-url", "file:///etc/passwd"])).toThrow(/Invalid --base-url/);
    expect(() => parseCaptureCliArgs(["--base-url", "javascript:alert(1)"])).toThrow(/Invalid --base-url/);
  });

  test("9. rejects path traversal outside repository root in output-dir", () => {
    expect(() => parseCaptureCliArgs(["--output-dir", "../../etc"])).toThrow(/Path traversal outside repository root is forbidden/);
    expect(() => parseCaptureCliArgs(["--output-dir", "../../../tmp"])).toThrow(/Path traversal outside repository root is forbidden/);
  });

  test("10. accepts valid nested output directory paths", () => {
    const options = parseCaptureCliArgs(["--output-dir", "artifacts/deeply/nested/output"]);
    expect(options.outputDir).toBe(path.resolve(process.cwd(), "artifacts/deeply/nested/output"));
  });
});
