import "./helpers/domSetup";
import assert from "node:assert/strict";
import { getChineseCommunityQrConfigUrl } from "../src/utils/chineseCommunityQr";

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
