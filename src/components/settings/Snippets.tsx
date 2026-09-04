import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SnippetEntry } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface SnippetsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const normalizeTrigger = (value: string) =>
  value
    .replace(/[<>"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Fase 8. Unlike Custom Dictionary (a substitution applied anywhere inside
// the transcription), a snippet only fires when its trigger is the *whole*
// dictated utterance — see apply_snippets in audio_toolkit/text.rs — so the
// expansion field can hold a full multi-line block without risking it
// swapping into the middle of an unrelated dictation.
export const Snippets: React.FC<SnippetsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [triggerDraft, setTriggerDraft] = useState("");
    const [expansionDraft, setExpansionDraft] = useState("");
    const entries = getSetting("snippets") || [];
    const normalizedTrigger = normalizeTrigger(triggerDraft);
    const normalizedExpansion = expansionDraft.trim();
    const isBusy = isUpdating("snippets");

    const handleAddEntry = () => {
      if (!normalizedTrigger || !normalizedExpansion) return;
      if (normalizedTrigger.length > 100 || normalizedExpansion.length > 2000)
        return;

      if (
        entries.some(
          (entry) =>
            entry.trigger.toLowerCase() === normalizedTrigger.toLowerCase(),
        )
      ) {
        toast.error(
          t("settings.advanced.snippets.duplicate", {
            trigger: normalizedTrigger,
          }),
        );
        return;
      }

      // Client-side id, same reasoning as Custom Dictionary: not
      // crypto.randomUUID(), which needs a secure context Tauri's webview
      // doesn't guarantee.
      const newEntry: SnippetEntry = {
        id: `snippet_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        trigger: normalizedTrigger,
        expansion: normalizedExpansion,
      };
      updateSetting("snippets", [...entries, newEntry]);
      setTriggerDraft("");
      setExpansionDraft("");
    };

    const handleRemoveEntry = (id: string) => {
      updateSetting(
        "snippets",
        entries.filter((entry) => entry.id !== id),
      );
    };

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.snippets.title")}
          description={t("settings.advanced.snippets.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex flex-col gap-2 w-full max-w-sm">
            <Input
              type="text"
              value={triggerDraft}
              onChange={(e) => setTriggerDraft(e.target.value)}
              placeholder={t("settings.advanced.snippets.triggerPlaceholder")}
              variant="compact"
              disabled={isBusy}
            />
            <Textarea
              value={expansionDraft}
              onChange={(e) => setExpansionDraft(e.target.value)}
              placeholder={t("settings.advanced.snippets.expansionPlaceholder")}
              variant="compact"
              disabled={isBusy}
            />
            <Button
              onClick={handleAddEntry}
              disabled={
                !normalizedTrigger ||
                !normalizedExpansion ||
                normalizedTrigger.length > 100 ||
                normalizedExpansion.length > 2000 ||
                isBusy
              }
              variant="primary"
              size="md"
              className="self-start"
            >
              {t("settings.advanced.snippets.add")}
            </Button>
          </div>
        </SettingContainer>
        {entries.length > 0 && (
          <div
            className={`px-4 p-2 ${grouped ? "" : "rounded-lg border border-mid-gray/20"} flex flex-col gap-1`}
          >
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-2 py-1 border-b border-mid-gray/10 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-sm">
                    {entry.trigger}
                  </span>
                  <p className="text-xs text-mid-gray truncate">
                    {entry.expansion}
                  </p>
                </div>
                <Button
                  onClick={() => handleRemoveEntry(entry.id)}
                  disabled={isBusy}
                  variant="secondary"
                  size="sm"
                  className="shrink-0 cursor-pointer"
                  aria-label={t("settings.advanced.snippets.remove", {
                    trigger: entry.trigger,
                  })}
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </Button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  },
);
