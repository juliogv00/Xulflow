import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DictionaryEntry } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface CustomDictionaryProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const normalizeEntryText = (value: string) =>
  value
    .replace(/[<>"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Substitutions apply after transcription, not the model — this dictionary
// is complementary to Custom Words (which biases the model toward correct
// vocabulary), for cases where the wrong and right text look nothing alike
// (e.g. "cloud" -> "Claude Code").
export const CustomDictionary: React.FC<CustomDictionaryProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [fromDraft, setFromDraft] = useState("");
    const [toDraft, setToDraft] = useState("");
    const entries = getSetting("custom_dictionary") || [];
    const normalizedFrom = normalizeEntryText(fromDraft);
    const normalizedTo = normalizeEntryText(toDraft);
    const isBusy = isUpdating("custom_dictionary");

    const handleAddEntry = () => {
      if (!normalizedFrom || !normalizedTo) return;
      if (normalizedFrom.length > 100 || normalizedTo.length > 100) return;

      if (
        entries.some(
          (entry) => entry.from.toLowerCase() === normalizedFrom.toLowerCase(),
        )
      ) {
        toast.error(
          t("settings.advanced.customDictionary.duplicate", {
            word: normalizedFrom,
          }),
        );
        return;
      }

      // Generated client-side, unlike the post-process prompts (which get
      // their id from a Rust command) — there's no backend command for
      // dictionary entries. Deliberately not crypto.randomUUID(): that
      // requires a secure context, which isn't guaranteed inside Tauri's
      // webview, and a failure there would silently no-op this whole handler.
      const newEntry: DictionaryEntry = {
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        from: normalizedFrom,
        to: normalizedTo,
      };
      updateSetting("custom_dictionary", [...entries, newEntry]);
      setFromDraft("");
      setToDraft("");
    };

    const handleRemoveEntry = (id: string) => {
      updateSetting(
        "custom_dictionary",
        entries.filter((entry) => entry.id !== id),
      );
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddEntry();
      }
    };

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.customDictionary.title")}
          description={t("settings.advanced.customDictionary.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              className="max-w-32"
              value={fromDraft}
              onChange={(e) => setFromDraft(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={t("settings.advanced.customDictionary.fromPlaceholder")}
              variant="compact"
              disabled={isBusy}
            />
            <span className="text-mid-gray text-sm">
              {t("settings.advanced.customDictionary.arrow")}
            </span>
            <Input
              type="text"
              className="max-w-32"
              value={toDraft}
              onChange={(e) => setToDraft(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={t("settings.advanced.customDictionary.toPlaceholder")}
              variant="compact"
              disabled={isBusy}
            />
            <Button
              onClick={handleAddEntry}
              disabled={
                !normalizedFrom ||
                !normalizedTo ||
                normalizedFrom.length > 100 ||
                normalizedTo.length > 100 ||
                isBusy
              }
              variant="primary"
              size="md"
            >
              {t("settings.advanced.customDictionary.add")}
            </Button>
          </div>
        </SettingContainer>
        {entries.length > 0 && (
          <div
            className={`px-4 p-2 ${grouped ? "" : "rounded-lg border border-mid-gray/20"} flex flex-wrap gap-1`}
          >
            {entries.map((entry) => (
              <Button
                key={entry.id}
                onClick={() => handleRemoveEntry(entry.id)}
                disabled={isBusy}
                variant="secondary"
                size="sm"
                className="inline-flex items-center gap-1 cursor-pointer"
                aria-label={t("settings.advanced.customDictionary.remove", {
                  from: entry.from,
                  to: entry.to,
                })}
              >
                <span>
                  {entry.from} → {entry.to}
                </span>
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
            ))}
          </div>
        )}
      </>
    );
  },
);
