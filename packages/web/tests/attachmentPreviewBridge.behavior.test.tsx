import assert from "node:assert/strict";
import { act } from "react";
import { IntlProvider } from "react-intl";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { useAttachmentPreviewBridge } from "../src/components/message/attachmentPreviewBridge";
import { HtmlAttachmentPreviewModal } from "../src/components/message/attachmentPreviewSurfaces";
import { en as enMessages } from "../src/i18n/messages/en";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(cleanup);

test("each iframe load receives a fresh parent-minted document epoch", () => {
  const messages: Array<Record<string, unknown>> = [];
  const { result } = renderHook(() => useAttachmentPreviewBridge());
  result.current.iframeRef.current = {
    contentWindow: {
      postMessage(message: Record<string, unknown>) {
        messages.push(message);
      },
    },
  } as unknown as HTMLIFrameElement;

  act(() => result.current.activateDocument());
  act(() => result.current.activateDocument());

  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, "activate-document");
  assert.equal(messages[1].type, "activate-document");
  assert.equal(messages[0].nonce, messages[1].nonce, "the preview instance nonce remains stable");
  assert.equal(typeof messages[0].documentEpoch, "string");
  assert.equal(typeof messages[1].documentEpoch, "string");
  assert.notEqual(
    messages[0].documentEpoch,
    messages[1].documentEpoch,
    "a preview-lifetime epoch would let delayed old-document reports cross a self-navigation",
  );
});

test("offline-static HTML preview clears the loading veil on iframe load without waiting for the script bridge", () => {
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <HtmlAttachmentPreviewModal
        filename="report.html"
        url="http://127.0.0.1:5280/api/attachments/att-1/html-preview?previewToken=tok"
        previewMode="offline-static"
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </IntlProvider>,
  );

  const iframe = screen.getByTitle("HTML preview: report.html") as HTMLIFrameElement;
  assert.equal(iframe.getAttribute("sandbox"), "");
  assert.equal(iframe.getAttribute("src"), "http://127.0.0.1:5280/api/attachments/att-1/html-preview?previewToken=tok");
  assert.ok(document.querySelector('[data-message-affordance="attachment-preview-external-links-loading"]'));

  fireEvent.load(iframe);

  assert.ok(document.querySelector('[data-message-affordance="attachment-preview-external-links-loading"]') === null);
  assert.equal(iframe.className.includes("pointer-events-none"), false);
});

test("sandboxed-interactive HTML preview keeps waiting for the external-links bridge report after iframe load", () => {
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <HtmlAttachmentPreviewModal
        filename="interactive.html"
        url="http://127.0.0.1:5280/api/attachments/att-2/html-preview?previewToken=tok"
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </IntlProvider>,
  );

  const iframe = screen.getByTitle("HTML preview: interactive.html") as HTMLIFrameElement;
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts");
  fireEvent.load(iframe);

  assert.ok(document.querySelector('[data-message-affordance="attachment-preview-external-links-loading"]'));
});
