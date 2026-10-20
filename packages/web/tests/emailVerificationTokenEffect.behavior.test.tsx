import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { TestIntlProvider, renderWithIntl as render } from "./helpers/intl";
import EmailVerificationPage from "../src/components/auth/EmailVerificationPage";
import { useAuthStore } from "../src/store/authStore";
import api from "../src/api/client";
import { __resetAuthProvidersForTest } from "../src/hooks/useAuthProviders";

/**
 * task #709 (Josh's review): the auto-verify effect must fire only when
 * `initialToken` changes. A locale switch produces a new `formatMessage`
 * identity — before the useEffectEvent fix, that cascaded into a new
 * `handleVerify` identity and re-ran the effect, re-verifying an
 * already-consumed token (success screen flipping to a failure banner).
 */

const initialAuthState = useAuthStore.getInitialState();

beforeEach(() => {
  __resetAuthProvidersForTest();
  vi.spyOn(api, "get").mockResolvedValue({ data: { providers: [], deploymentMode: "standard" } });
});

afterEach(() => {
  cleanup();
  __resetAuthProvidersForTest();
  useAuthStore.setState(initialAuthState, true);
});

test("a locale switch does not re-verify an already-consumed token", async () => {
  let verifyCalls = 0;
  useAuthStore.setState({
    ...initialAuthState,
    verifyEmail: async () => {
      verifyCalls += 1;
    },
    resendVerification: async () => {},
    logout: async () => {},
    user: null,
    initialized: true,
  } as never);

  const { rerender } = render(<EmailVerificationPage initialToken="token-abc" />);
  await waitFor(() => assert.equal(verifyCalls, 1));

  // New IntlProvider (different locale ⇒ new formatMessage identity): the
  // effect must NOT fire again.
  rerender(
    <TestIntlProvider locale="zh-cn">
      <EmailVerificationPage initialToken="token-abc" />
    </TestIntlProvider>,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(verifyCalls, 1);
});


test("standalone recovers a stale verification page through password sign-in", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { providers: [], deploymentMode: "standalone" } });
  const verifyEmail = vi.fn();
  const login = vi.fn().mockResolvedValue(undefined);
  useAuthStore.setState({
    verifyEmail,
    login,
    user: { email: "owner@example.test", emailVerified: false } as never,
    initialized: true,
  });
  render(<EmailVerificationPage initialToken="already-expired-token" />);
  await screen.findByRole("heading", { name: "Sign in to your local workspace" });
  assert.equal(verifyEmail.mock.calls.length, 0);
  assert.equal(screen.queryByText("Invalid or expired verification token"), null);
  assert.equal(screen.queryByText(/Forgot password/), null);
  assert.equal((screen.getByLabelText("Email") as HTMLInputElement).value, "owner@example.test");
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "local-password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign In" }).closest("form")!);
  await waitFor(() => assert.equal(login.mock.calls.length, 1));
  assert.deepEqual(login.mock.calls[0], ["owner@example.test", "local-password"]);
  assert.equal(verifyEmail.mock.calls.length, 0);
});
