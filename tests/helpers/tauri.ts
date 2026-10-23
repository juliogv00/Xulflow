import type { Page } from "@playwright/test";

/** IPC boundary fixture: UI tests exercise the real components, stores and events. */
export async function mockTauri(
  page: Page,
  overrides: Record<string, unknown> = {},
) {
  await page.addInitScript((overrides) => {
    const callbacks = new Map<number, (payload: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let next = 0;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const settings = {
      onboarding_completed: true,
      app_language: "es",
      theme: "system",
      bindings: {
        transcribe: {
          id: "transcribe",
          name: "Transcribe",
          description: "",
          current_binding: "alt+space",
          default_binding: "alt+space",
        },
        cancel: {
          id: "cancel",
          name: "Cancel",
          description: "",
          current_binding: "escape",
          default_binding: "escape",
        },
      },
      shortcut_activation: "toggle",
      selected_microphone: "Default",
      selected_output_device: "Default",
      audio_feedback: true,
      audio_feedback_volume: 0.5,
      sound_theme: "marimba",
      selected_language: "auto",
      selected_model: "test-model",
      overlay_position: "bottom",
      show_whats_new_on_update: false,
      update_checks_enabled: false,
      custom_words: [],
      custom_dictionary: [],
      snippets: [],
      post_process_providers: [],
      post_process_prompts: [],
      post_process_model_options: {},
      history_limit: 100,
      recording_retention_period: "never",
      model_unload_timeout: "never",
      ...overrides,
    };
    const model = {
      id: "test-model",
      name: "Whisper Large V3 Turbo",
      description: "Multilingual voice model",
      is_downloaded: true,
      is_downloading: false,
      is_recommended: true,
      accuracy: 4,
      speed: 4,
      size_mb: 810,
      supported_languages: ["en", "es", "fr"],
      supports_language_selection: true,
      supports_language_detection: true,
      supports_translation: true,
      engine_type: "Whisper",
      filename: "model.gguf",
      source: "Local",
    };
    const emit = (event: string, payload: unknown) => {
      for (const [id, listener] of listeners) {
        if (listener.event === event)
          callbacks.get(listener.handler)?.({ event, id, payload });
      }
    };
    Object.assign(window, {
      __TAURI_OS_PLUGIN_INTERNALS__: {
        platform: "macos",
        os_type: "macos",
        family: "unix",
        arch: "aarch64",
        eol: "\n",
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (_: string, id: number) => listeners.delete(id),
      },
      __flowTest: { emit, calls, listeners, settings },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          const id = ++next;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push({ command, args });
          if (command === "plugin:event|listen") {
            const id = ++next;
            listeners.set(id, {
              event: String(args.event),
              handler: Number(args.handler),
            });
            return id;
          }
          if (command === "plugin:event|unlisten") {
            listeners.delete(Number(args.eventId));
            return;
          }
          if (command.includes("permission"))
            return overrides.test_permissions_granted !== false;
          if (
            command === "get_app_settings" ||
            command === "get_default_settings"
          ) {
            if (overrides.test_settings_delay_ms)
              await new Promise((resolve) =>
                setTimeout(resolve, Number(overrides.test_settings_delay_ms)),
              );
            return settings;
          }
          if (command === "get_available_models") return [model];
          if (command === "get_current_model") return model.id;
          if (command === "get_transcription_model_status") return model.id;
          if (command === "plugin:app|version") return "0.9.6";
          if (command === "plugin:os|locale") return "es-ES";
          if (
            command === "get_available_microphones" ||
            command === "get_available_output_devices"
          )
            return [{ index: "default", name: "Default", is_default: true }];
          if (command === "get_microphone_channels") return 1;
          if (command === "check_custom_sounds")
            return { start: false, stop: false };
          if (command === "get_history_entries")
            return { entries: [], has_more: false };
          if (command === "get_secure_input_status")
            return {
              active: false,
              sustained: false,
              degraded_bindings: [],
              uncovered_bindings: [],
              recorder_blocked: false,
            };
          if (command === "change_sound_theme_setting")
            settings.sound_theme = String(args.theme);
          if (
            command.includes("directory") ||
            command.startsWith("plugin:path|")
          )
            return "/tmp/flow-test";
          if (
            command.startsWith("is_") ||
            command === "plugin:autostart|is_enabled"
          )
            return false;
          return null;
        },
      },
    });
  }, overrides);
}

export async function emitTauri(
  page: Page,
  event: string,
  payload: unknown = null,
) {
  await page.evaluate(
    ({ event, payload }) => {
      (
        window as unknown as {
          __flowTest: { emit: (event: string, payload: unknown) => void };
        }
      ).__flowTest.emit(event, payload);
    },
    { event, payload },
  );
}

export async function waitForOverlay(page: Page) {
  await page.waitForFunction(() => {
    const fixture = (
      window as unknown as {
        __flowTest: { listeners: Map<number, { event: string }> };
      }
    ).__flowTest;
    return (
      [...fixture.listeners.values()].filter(
        (listener) => listener.event === "stream-phase-event",
      ).length === 1
    );
  });
}
