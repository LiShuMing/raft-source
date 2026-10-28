import assert from "node:assert/strict";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import PersonalNavigation from "../src/components/personal/PersonalNavigation";
import { useServerStore } from "../src/store/serverStore";
import { useChannelStore } from "../src/store/channelStore";
import { TestIntlProvider } from "./helpers/intl";

const serverState = useServerStore.getState();
const channelState = useChannelStore.getState();
afterEach(() => {
  cleanup();
  useServerStore.setState(serverState, true);
  useChannelStore.setState(channelState, true);
});

function Path() { return <output data-testid="path">{useLocation().pathname}</output>; }
function mount(mobile = false) {
  useServerStore.setState({ current: { id: "s1", slug: "home", name: "Home" } as never, servers: [{ id: "s1", slug: "home", name: "Home" }, { id: "s2", slug: "other", name: "Other" }] as never });
  return render(<MemoryRouter initialEntries={["/s/home/tasks"]}><TestIntlProvider><PersonalNavigation mobile={mobile} /><Path /></TestIntlProvider></MemoryRouter>);
}

test("minimal navigation preserves task selection and links to real conversations", () => {
  useChannelStore.setState({ dmChannels: [
    { id: "older", name: "Older", type: "dm", createdAt: "2026-01-01" },
    { id: "newer", name: "Recent", type: "dm", createdAt: "2026-01-01" },
    { id: "archived", name: "Archived", type: "dm", archivedAt: "2026-01-01", createdAt: "2026-01-01" },
  ] as never, channelActivity: { older: "2026-01-02", newer: "2026-01-03" } });
  const view = mount();
  assert.equal(view.getByRole("link", { name: "Tasks" }).getAttribute("aria-current"), "page");
  assert.equal(view.queryByRole("link", { name: "Archived" }), null);
  const links = view.getAllByRole("navigation", { name: "Conversations" })[0]!.querySelectorAll("a");
  assert.equal(links[0]!.getAttribute("href"), "/s/home/dm/newer");
  fireEvent.click(view.getByRole("link", { name: "Recent" }));
  assert.equal(view.getByTestId("path").textContent, "/s/home/dm/newer");
});

test("workspace selection opens the chosen personal home instead of retaining the old DM", async () => {
  const view = mount();
  fireEvent.click(view.getByText("Connections & settings"));
  fireEvent.change(view.getByLabelText("Workspace"), { target: { value: "other" } });
  await waitFor(() => assert.equal(view.getByTestId("path").textContent, "/s/other/personal"));
});

test("mobile navigation keeps new conversation, tasks and API settings reachable", () => {
  const view = mount(true);
  assert.equal(view.getByRole("link", { name: "New conversation" }).getAttribute("href"), "/s/home/personal");
  assert.equal(view.getByRole("link", { name: "Connections & settings" }).getAttribute("href"), "/s/home/settings/providers");
  assert.equal(view.getAllByRole("navigation").length, 1);
});
