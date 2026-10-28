import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PersonalHomeView } from "../src/components/personal/PersonalHome";
import type { PersonalHomeProps } from "../src/components/personal/PersonalHome";
import { TestIntlProvider } from "./helpers/intl";

afterEach(cleanup);

function props(overrides: Partial<PersonalHomeProps> = {}): PersonalHomeProps {
  return {
    agents: [{ id: "agent-1", name: "Atlas", displayName: null, runtime: "codex", machineId: "mac-1", deletedAt: null } as never],
    machines: [{ id: "mac-1", name: "My Mac", hostname: "mac-test", status: "offline" } as never],
    loading: false, machineError: false, canCreateAgent: true, canConnectComputer: true,
    onCreateAgent() {}, onComputers() {}, onProviders() {}, onRefresh() {},
    async onConversation() {}, async onSubmit() {},
    ...overrides,
  };
}

test("the empty state offers setup, and an example only edits the draft", () => {
  let sends = 0;
  let creates = 0;
  const view = render(<TestIntlProvider><PersonalHomeView {...props({ agents: [], onCreateAgent: () => creates++, onSubmit: async () => { sends++; } })} /></TestIntlProvider>);
  fireEvent.click(view.getByRole("button", { name: "Research a topic" }));
  assert.ok((view.getByLabelText("Your goal") as HTMLTextAreaElement).value.includes("Research this topic"));
  assert.equal(sends, 0);
  assert.ok((view.getByRole("button", { name: "Start task" }) as HTMLButtonElement).disabled);
  fireEvent.click(view.getAllByRole("button", { name: "Add an Agent" })[0]!);
  assert.equal(creates, 1);
});

test("failed sends retain text, expose an offline host, and allow a retry", async () => {
  let attempts = 0;
  const view = render(<TestIntlProvider><PersonalHomeView {...props({ onSubmit: async () => { if (++attempts === 1) throw new Error("offline"); } })} /></TestIntlProvider>);
  assert.ok(view.getByRole("status").textContent?.includes("mac-test"));
  assert.ok(view.getByRole("status").textContent?.includes("offline"));
  fireEvent.change(view.getByLabelText("Your goal"), { target: { value: "Inspect my test directory" } });
  fireEvent.click(view.getByRole("button", { name: "Start task" }));
  await waitFor(() => assert.ok(view.getByRole("alert")));
  assert.equal((view.getByLabelText("Your goal") as HTMLTextAreaElement).value, "Inspect my test directory");
  fireEvent.click(view.getByRole("button", { name: "Start task" }));
  await waitFor(() => assert.equal((view.getByLabelText("Your goal") as HTMLTextAreaElement).value, ""));
  assert.equal(attempts, 2);
});

test("submitting locks the composer and suppresses duplicate click/keyboard sends", async () => {
  let complete!: () => void;
  let calls = 0;
  const view = render(<TestIntlProvider><PersonalHomeView {...props({ onSubmit: () => { calls++; return new Promise<void>((resolve) => { complete = resolve; }); } })} /></TestIntlProvider>);
  fireEvent.change(view.getByLabelText("Your goal"), { target: { value: "Inspect code" } });
  fireEvent.keyDown(view.getByLabelText("Your goal"), { key: "Enter", metaKey: true });
  fireEvent.keyDown(view.getByLabelText("Your goal"), { key: "Enter", ctrlKey: true });
  assert.equal(calls, 1);
  assert.ok((view.getByLabelText("Your goal") as HTMLTextAreaElement).disabled);
  complete();
  await waitFor(() => assert.ok(!(view.getByLabelText("Your goal") as HTMLTextAreaElement).disabled));
});
