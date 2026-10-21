import "./helpers/domSetup";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl as render } from "./helpers/intl";
import api from "../src/api/client";
import StandaloneComputerConnect from "../src/components/machine/StandaloneComputerConnect";
import { useMachineStore } from "../src/store/machineStore";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("standalone keeps local setup and offers private remote enrollment without vendor installers", async () => {
  vi.spyOn(api, "get").mockImplementation(async (url) => ({ data: String(url).endsWith("remote-computer")
    ? { ready: true, serverSlug: "work", port: 5280, filename: "raft-runner-linux-x64.tar.gz", platform: "linux", arch: "x64", nodeMajor: 24, sha256: "a".repeat(64) }
    : { hostname: "admin", platform: "linux", state: "offline" } }));
  vi.spyOn(useMachineStore.getState(), "loadMachines").mockResolvedValue(undefined);
  await act(async () => { render(<StandaloneComputerConnect serverId="workspace-id" />); });
  assert.ok(screen.getByRole("button", { name: "Use server host" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Another machine" })); });
  assert.ok(screen.getByRole("button", { name: "Download private runner" }));
  assert.ok(screen.getByRole("link", { name: "device approval" }));
  assert.ok(screen.getByText(/\.\/connect setup --server-url/));
  assert.equal(screen.queryByText(/cdn\.raft\.build|curl.*install\.sh/), null);
  await act(async () => { fireEvent.change(screen.getByLabelText("Center URL as seen from the target machine"), { target: { value: "http://192.0.2.1:5280" } }); });
  assert.ok(screen.getByText("Use an HTTPS origin, or HTTP loopback through an SSH tunnel."));
  assert.equal(screen.queryByText(/\.\/connect setup --server-url/), null);
});

test("a denied enrollment does not offer a package or create a machine credential", async () => {
  vi.spyOn(api, "get").mockRejectedValue({ response: { data: { error: "An owner or admin must enroll remote Computers" } } });
  const post = vi.spyOn(api, "post");
  vi.spyOn(useMachineStore.getState(), "loadMachines").mockResolvedValue(undefined);
  await act(async () => { render(<StandaloneComputerConnect serverId="workspace-id" />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Another machine" })); });
  assert.ok(screen.getByText("An owner or admin must enroll remote Computers"));
  assert.equal((screen.getByRole("button", { name: "Download private runner" }) as HTMLButtonElement).disabled, true);
  assert.equal(post.mock.calls.length, 0);
});
