import { test, expect } from "@playwright/test";
import { mockTauri, emitTauri, waitForOverlay } from "./helpers/tauri";

test("light workspace keeps navigation, settings and sound preview functional", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockTauri(page);
  await page.setViewportSize({ width: 1040, height: 780 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Deja hablar a tus ideas." }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "VMNTe flow" })).toBeVisible();
  await page
    .getByRole("button", { name: "Probar sonido", exact: true })
    .click();
  const sounds = await page.evaluate(() =>
    (
      window as unknown as {
        __flowTest: {
          calls: { command: string; args: { soundType: string } }[];
        };
      }
    ).__flowTest.calls
      .filter((call) => call.command === "play_test_sound")
      .map((call) => call.args.soundType),
  );
  expect(sounds).toEqual(["start", "stop"]);
  await page.waitForTimeout(950);
  await page.screenshot({ path: "test-results/flow-home.png" });
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await expect(page.locator(".page-heading h1")).toHaveText("Historial");
  await page.getByRole("button", { name: "Modelos", exact: true }).click();
  await expect(page.locator(".page-heading h1")).toHaveText("Modelos");
  await expect(page.locator(".app-content")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/flow-models.png" });
  await page.getByRole("button", { name: "Avanzado", exact: true }).click();
  await expect(page.locator(".page-heading h1")).toHaveText("Avanzado");
  await expect(page.locator(".app-content")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/flow-advanced.png" });
  await page.getByRole("button", { name: "Acerca de", exact: true }).click();
  await expect(page.locator(".page-heading h1")).toHaveText("Acerca de");
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.setViewportSize({ width: 680, height: 570 });
  await expect(page.locator(".voice-hero")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.waitForTimeout(950);
  await page.screenshot({ path: "test-results/flow-compact.png" });
  expect(errors).toEqual([]);
});

test("recording orb follows capture events and preserves exit animation", async ({
  page,
}) => {
  await mockTauri(page);
  await page.setViewportSize({ width: 256, height: 156 });
  await page.goto("/src/overlay/index.html");
  await waitForOverlay(page);
  await emitTauri(page, "show-overlay", "recording");
  await expect(page.getByRole("status")).toHaveText("Conectando micrófono");
  await emitTauri(page, "recording-ready");
  await emitTauri(page, "mic-level", Array(16).fill(0.7));
  await expect(page.getByRole("status")).toContainText("Escuchando");
  await expect(page.locator(".glass-orb")).toHaveAttribute(
    "data-state",
    "listening",
  );
  await page.waitForTimeout(950);
  await page.screenshot({
    path: "test-results/flow-recording.png",
    omitBackground: true,
  });
  const bounds = await page.locator(".recording-orb").boundingBox();
  expect(
    bounds && bounds.y >= 0 && bounds.y + bounds.height <= 156,
  ).toBeTruthy();
  await page.getByRole("button", { name: "Cancelar" }).click();
  const cancelled = await page.evaluate(() =>
    (
      window as unknown as { __flowTest: { calls: { command: string }[] } }
    ).__flowTest.calls.some((call) => call.command === "cancel_operation"),
  );
  expect(cancelled).toBeTruthy();
  await emitTauri(page, "show-overlay", "transcribing");
  await expect(page.locator(".glass-orb")).toHaveAttribute(
    "data-state",
    "working",
  );
  await emitTauri(page, "hide-overlay");
  await expect(page.locator(".ov-stage")).toHaveClass(/leaving/);
  await expect(page.locator(".ov-stage")).toHaveCount(0);
});

test("live transcript survives finalizing and fits both overlay placements", async ({
  page,
}) => {
  await mockTauri(page, { overlay_position: "top" });
  await page.setViewportSize({ width: 400, height: 276 });
  await page.goto("/src/overlay/index.html");
  await waitForOverlay(page);
  await emitTauri(page, "show-overlay", "streaming");
  await expect(page.locator(".ov-stage")).toHaveClass(/top/);
  await emitTauri(page, "recording-ready");
  await emitTauri(page, "stream-text-event", {
    committed: "Las ideas empiezan con tu voz.",
    tentative: "Y siguen a tu ritmo.",
  });
  await expect(page.locator(".orb-transcript")).toContainText(
    "Las ideas empiezan con tu voz.",
  );
  await emitTauri(page, "stream-phase-event", {
    phase: "working",
    kind: "polishing",
  });
  await expect(page.locator(".glass-orb")).toHaveAttribute(
    "data-state",
    "working",
  );
  await expect(page.locator(".orb-transcript")).toBeVisible();
  await page.waitForTimeout(950);
  await page.screenshot({
    path: "test-results/flow-streaming.png",
    omitBackground: true,
  });
  const bounds = await page.locator(".orb-transcript").boundingBox();
  expect(bounds && bounds.y + bounds.height <= 276).toBeTruthy();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".glass-orb__texture")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await emitTauri(page, "hide-overlay");
  await emitTauri(page, "show-overlay", "streaming");
  await expect(page.locator(".orb-transcript")).toHaveCount(0);
  await expect(page.locator(".ov-stage")).toHaveClass(/show/);
});

test("permission onboarding uses the new brand and remains usable", async ({
  page,
}) => {
  await mockTauri(page, {
    onboarding_completed: false,
    test_permissions_granted: false,
  });
  await page.setViewportSize({ width: 680, height: 570 });
  await page.goto("/");
  await expect(page.getByRole("img", { name: "VMNTe flow" })).toBeVisible();
  await expect(page.locator(".onboarding-screen button").first()).toBeVisible();
  await page.screenshot({ path: "test-results/flow-onboarding.png" });
});

test("a quick cancel cannot be undone by a late settings response", async ({
  page,
}) => {
  await mockTauri(page, { test_settings_delay_ms: 200 });
  await page.goto("/src/overlay/index.html");
  await waitForOverlay(page);
  await emitTauri(page, "show-overlay", "recording");
  await expect(page.locator(".ov-stage")).toHaveClass(/show/);
  await emitTauri(page, "hide-overlay");
  await page.waitForTimeout(650);
  await expect(page.locator(".ov-stage")).toHaveCount(0);
});

test("all eight sound signatures can be selected and previewed", async ({
  page,
}) => {
  await mockTauri(page);
  await page.goto("/");
  await expect(page).toHaveTitle("VMNTe flow");
  const themes = [
    ["pop", "Fieltro"],
    ["droplet", "Gota"],
    ["silk", "Seda"],
    ["wood", "Madera"],
    ["orbit", "Órbita"],
    ["air", "Aire"],
    ["pulse", "Pulso"],
    ["marimba", "Cristal"],
  ];
  let selected = "Cristal";
  for (const [id, label] of themes) {
    await page.getByRole("button", { name: selected, exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", { name: "Escuchar los sonidos de inicio y fin" })
      .click();
    const state = await page.evaluate(() => {
      const fixture = (
        window as unknown as {
          __flowTest: {
            settings: { sound_theme: string };
            calls: { command: string; args: Record<string, unknown> }[];
          };
        }
      ).__flowTest;
      return {
        theme: fixture.settings.sound_theme,
        events: fixture.calls
          .filter((call) => call.command === "play_test_sound")
          .slice(-2)
          .map((call) => call.args.soundType),
      };
    });
    expect(state).toEqual({ theme: id, events: ["start", "stop"] });
    selected = label;
  }
});
