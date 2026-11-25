import "./helpers/domSetup";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { getChineseCommunityQrConfigUrl } from "../src/utils/chineseCommunityQr";
import { PersonAvatar } from "../src/components/member/PersonAvatar";

afterEach(() => {
  cleanup();
  document.querySelector('meta[name="raft-deployment-mode"]')?.remove();
});

test("standalone community content cannot override its local configuration URL", () => {
  const meta = document.createElement("meta");
  meta.name = "raft-deployment-mode";
  meta.content = "standalone";
  document.head.append(meta);
  window.__RAFT_CHINESE_COMMUNITY_QR_CONFIG_URL__ = "https://audit.invalid/leak";
  try {
    assert.equal(getChineseCommunityQrConfigUrl(), "/community/chinese-qr.json");
  } finally {
    meta.remove();
    delete window.__RAFT_CHINESE_COMMUNITY_QR_CONFIG_URL__;
  }
});

test("standalone never mounts cross-origin avatar URLs and keeps same-origin uploaded avatars", () => {
  const meta = document.createElement("meta");
  meta.name = "raft-deployment-mode";
  meta.content = "standalone";
  document.head.append(meta);
  const first = render(<PersonAvatar avatarUrl="https://audit.invalid/api/avatars/users/abcd.webp" />);
  assert.equal(first.container.querySelector("img"), null);
  first.unmount();
  const second = render(<PersonAvatar avatarUrl="/api/avatars/users/abcd.webp" />);
  assert.equal(second.container.querySelector("img")?.getAttribute("src"), "/api/avatars/users/abcd.webp");
});
