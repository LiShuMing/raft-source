import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isGlibcLoaderWrapperScript, resolveAntigravityAcpCommand } from "./antigravityAcpCommand";

test("native ELF or ordinary scripts are not treated as glibc loader wrappers", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "raft-agy-shim-test-"));
  try {
    const elf = path.join(dir, "agy-elf");
    writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
    const plain = path.join(dir, "agy-plain");
    writeFileSync(plain, "#!/usr/bin/env bash\nexec /usr/local/bin/agy.real \"$@\"\n", { mode: 0o755 });

    assert.equal(isGlibcLoaderWrapperScript(elf, "linux"), false);
    assert.equal(isGlibcLoaderWrapperScript(plain, "linux"), false);
    assert.equal(resolveAntigravityAcpCommand(elf, { platform: "linux", shimDir: dir }), elf);
    assert.equal(resolveAntigravityAcpCommand(plain, { platform: "linux", shimDir: dir }), plain);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("glibc ld-linux wrapper scripts get a private ACP shim that strips only --process-per-session", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "raft-agy-shim-test-"));
  try {
    const wrapper = path.join(dir, "agy");
    writeFileSync(
      wrapper,
      [
        "#!/usr/bin/env bash",
        "# simulates ld-linux-x86-64.so.2 invocation",
        "printf '%s\\n' \"$@\"",
      ].join("\n"),
      { mode: 0o755 },
    );

    assert.equal(isGlibcLoaderWrapperScript(wrapper, "linux"), true);
    assert.equal(isGlibcLoaderWrapperScript(wrapper, "win32"), false);

    const shim = resolveAntigravityAcpCommand(wrapper, { platform: "linux", shimDir: path.join(dir, "shims") });
    assert.notEqual(shim, wrapper);
    const forwarded = execFileSync(
      shim,
      ["acp", "--dangerously-skip-permissions", "--process-per-session", "--gemini-dir", "/tmp/my dir"],
      { encoding: "utf8" },
    ).trim().split("\n");
    assert.deepEqual(forwarded, ["acp", "--dangerously-skip-permissions", "--gemini-dir", "/tmp/my dir"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
