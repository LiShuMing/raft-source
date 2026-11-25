import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { getPublicContentStorage, resetStorageForTests } from "../services/storageService";

test("standalone derived assets use local storage even with inherited bucket configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-standalone-storage-"));
  try {
    vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
    vi.stubEnv("UPLOADS_DIR", dir);
    vi.stubEnv("S3_PUBLIC_CONTENT_ENDPOINT", "https://remote.invalid");
    resetStorageForTests();
    const storage = getPublicContentStorage();
    assert.ok(storage);
    const key = "content/v2/local/preview.txt";
    await storage.put(key, Buffer.from("local preview"), "text/plain");
    assert.equal(await readFile(path.join(dir, key), "utf8"), "local preview");
  } finally {
    resetStorageForTests();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
