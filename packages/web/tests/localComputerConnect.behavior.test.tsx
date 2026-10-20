import "./helpers/domSetup";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl as render } from "./helpers/intl";
import api from "../src/api/client";
import ComputerCommandGuide from "../src/components/machine/ComputerCommandGuide";
import { useMachineStore } from "../src/store/machineStore";

const serverId = "a72ed850-26c1-4827-b937-e93e29023392";
const offline = { hostname: "test-host", platform: "linux", machineId: null, state: "offline", error: null };

afterEach(() => { cleanup(); vi.useRealTimers(); });

test("local setup uses an authenticated button and waits for observed online status", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: offline });
  const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ...offline, state: "starting" } });
  vi.spyOn(useMachineStore.getState(), "loadMachines").mockResolvedValue(undefined);
  await act(async () => { render(<ComputerCommandGuide localServerId={serverId} computerCommand="raft-computer setup /local" computerInstallCommand="curl remote-installer | sh" />); });
  assert.equal(screen.queryByText(/curl remote-installer/), null);
  assert.ok(screen.getByText("test-host · linux"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use server host" })); });
  assert.equal(post.mock.calls.length, 1);
  assert.equal(post.mock.calls[0][0], `/servers/${serverId}/local-computer`);
  assert.equal(screen.queryByRole("button", { name: "Server host connected" }), null);
  get.mockResolvedValue({ data: { ...offline, state: "online" } });
  await act(async () => { vi.advanceTimersByTime(5000); });
  assert.ok(screen.getByRole("button", { name: "Server host connected" }));
  assert.equal((screen.getByRole("button", { name: "Server host connected" }) as HTMLButtonElement).disabled, true);
});

test("a denied local connection keeps the error visible and never claims success", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ data: offline });
  vi.spyOn(api, "post").mockRejectedValue({ response: { data: { error: "An owner or admin must connect the server host" } } });
  await act(async () => { render(<ComputerCommandGuide localServerId={serverId} computerCommand={null} computerInstallCommand={null} />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use server host" })); });
  assert.ok(screen.getByText("An owner or admin must connect the server host"));
  assert.equal(screen.queryByRole("button", { name: "Server host connected" }), null);
});

test("status polling recovers after a temporary server failure", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(api, "get")
    .mockRejectedValueOnce({ response: { data: { error: "Temporarily unavailable" } } })
    .mockResolvedValue({ data: { ...offline, state: "online" } });
  await act(async () => { render(<ComputerCommandGuide localServerId={serverId} computerCommand={null} computerInstallCommand={null} />); });
  assert.ok(screen.getByText("Temporarily unavailable"));
  await act(async () => { vi.advanceTimersByTime(5000); });
  assert.ok(screen.getByRole("button", { name: "Server host connected" }));
  assert.equal(screen.queryByText("Temporarily unavailable"), null);
});
