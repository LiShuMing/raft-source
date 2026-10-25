import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Check installation assets without modifying the user's persistent profile. */
export async function validateStandaloneWebDist(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const directory = path.resolve(env.RAFT_STANDALONE_WEB_DIST || fileURLToPath(new URL("../../../web/dist/", import.meta.url)));
  const index = path.join(directory, "index.html");
  try {
    if (!(await stat(index)).isFile()) throw new Error("index.html is not a regular file");
    await access(index, constants.R_OK);
  } catch (cause) {
    throw new Error(
      `Standalone web assets are missing or unreadable at ${index}. Run pnpm standalone:build, or set RAFT_STANDALONE_WEB_DIST to a built web directory.`,
      { cause },
    );
  }
  return directory;
}
