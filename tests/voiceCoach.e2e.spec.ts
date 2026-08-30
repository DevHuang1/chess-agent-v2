import { expect, test } from "@playwright/test";

/**
 * Voice Coach (Burmese) end-to-end tests.
 *
 * These mock the network boundaries (/api/transcribe, /api/coach, /api/tts) so
 * the tests exercise the real browser flow without depending on external
 * transcription or LLM providers. The dev-served Chromium uses fake media
 * devices (see playwright.config.ts), so getUserMedia works headlessly.
 *
 * The Voice Move path is unchanged and covered separately by unit tests
 * (lib/speechParser.test.ts, lib/voiceRecorder.test.ts).
 */

const BURMESE_QUESTION = "ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ";
const BURMESE_REPLY = "သင့်အတွက် ရဲတိုက်ကာကွယ်ရေးက အကောင်းဆုံးပါ။ e4 ကို ကစားပါ။";

/**
 * A tiny, actually-playable WAV (5s of 8-bit mono silence at 16 kHz).
 * The previous mock fed invalid MPEG bytes to `new Audio()`, which made
 * `audio.play()` reject with NotSupportedError so the player jumped straight
 * to its error state. 5 seconds keeps the player in the "playing" state long
 * enough to assert on the stop control before the clip finishes.
 */
function makeSilentWav(): Buffer {
  const sampleRate = 16_000;
  const frames = Math.round(sampleRate * 5);
  const data = Buffer.alloc(44 + frames, 0x80);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + frames, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16); // fmt chunk size
  data.writeUInt16LE(1, 20); // audio format = PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(sampleRate, 24); // sample rate
  data.writeUInt32LE(sampleRate, 28); // byte rate
  data.writeUInt16LE(1, 32); // block align
  data.writeUInt16LE(8, 34); // bits per sample
  data.write("data", 36);
  data.writeUInt32LE(frames, 40);
  return data;
}

function mockCoach(page: import("@playwright/test").Page) {
  return page.route("**/api/coach", (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, connected: true, detail: "mock" }),
      });
    }
    const payload = request.postDataJSON() as Record<string, unknown>;
    void page.evaluate((p) => {
      (
        window as unknown as { __lastCoachPayload?: Record<string, unknown> }
      ).__lastCoachPayload = p;
    }, payload);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: BURMESE_REPLY,
        suggestions: [],
        bestMove: null,
      }),
    });
  });
}

function mockTranscribe(page: import("@playwright/test").Page, text: string) {
  return page.route("**/api/transcribe", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text }),
    }),
  );
}

test("Voice Coach inserts a Burmese transcript, and a voice-coach submit sends position + responseLanguage my", async ({
  page,
}) => {
  await mockTranscribe(page, BURMESE_QUESTION);
  await mockCoach(page);

  await page.goto("/?e2e=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);

  await expect(page.locator("[data-voice-coach-control]")).toBeVisible();

  await page.getByRole("button", { name: /hold to ask/i }).click();
  await expect(page.getByText("RECORDING", { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /■ stop/i }).click();

  // Transcript is visible and editable before submission.
  await expect(page.getByLabel("Voice coach transcript")).toHaveValue(
    BURMESE_QUESTION,
  );

  await page.getByRole("button", { name: "Ask Coach" }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __lastCoachPayload?: Record<string, unknown>;
            }
          ).__lastCoachPayload ?? null,
      ),
    )
    .not.toBeNull();
  const payload = await page.evaluate(
    () =>
      (
        window as unknown as { __lastCoachPayload?: Record<string, unknown> }
      ).__lastCoachPayload as Record<string, unknown>,
  );
  expect(payload.question).toBe(BURMESE_QUESTION);
  expect(payload.responseLanguage).toBe("my");
  expect(payload.inputLanguage).toBe("my");
  expect(payload.source).toBe("voice-coach");
  expect(payload.fen).toBeTruthy();

  await expect(
    page.getByText(BURMESE_REPLY, { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });
});
test("TTS failure keeps the Burmese text visible and shows an audio-unavailable note", async ({
  page,
}) => {
  await page.route("**/api/coach", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, connected: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: BURMESE_REPLY,
        suggestions: [],
        bestMove: null,
      }),
    });
  });
  await page.route("**/api/tts", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );

  await page.goto("/?e2e=1");
  await page.waitForTimeout(900);

  // Ask a real question so the mocked Burmese reply is rendered in the chat.
  await page
    .getByPlaceholder("Ask coach for tactical advice or plan...")
    .fill("မြန်မာဘာသာဖြင့် အကြံပေးပါ");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(
    page.getByText(BURMESE_REPLY, { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // The read-aloud button on the assistant reply requests TTS; when TTS
  // fails, the visible Burmese text must remain and a note must appear.
  await page
    .locator('[aria-label^="Read reply aloud: assistant-"]')
    .last()
    .click();
  await expect(
    page.getByText("audio unavailable — text still shown", { exact: false }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(BURMESE_REPLY, { exact: false }).first(),
  ).toBeVisible();
});

test("speaker button requests TTS audio and plays it (loading -> playing)", async ({
  page,
}) => {
  await page.route("**/api/coach", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, connected: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: BURMESE_REPLY, bestMove: null }),
    });
  });
  await page.route("**/api/tts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: makeSilentWav(),
    }),
  );

  await page.goto("/?e2e=1");
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: /Read reply aloud/ }).first().click();
  await page.waitForTimeout(600);

  // The speaker becomes a stop control while playing, i.e. audio is engaged.
  // (The button's accessible name stays "Read reply aloud: <id>" — the inner
  // span text flips to "■ stop" — so assert on the span, not the role name.)
  await expect(page.locator("span", { hasText: "■ stop" }).first()).toBeVisible({
    timeout: 10_000,
  });
});