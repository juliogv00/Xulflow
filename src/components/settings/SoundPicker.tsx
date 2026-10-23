import React, { useState } from "react";
import type { SoundTheme } from "@/bindings";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Dropdown, DropdownOption } from "../ui/Dropdown";
import { PlayIcon } from "lucide-react";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSettings } from "../../hooks/useSettings";

interface SoundPickerProps {
  label: string;
  description: string;
}

export const SoundPicker: React.FC<SoundPickerProps> = ({
  label,
  description,
}) => {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const playTestSound = useSettingsStore((state) => state.playTestSound);
  const customSounds = useSettingsStore((state) => state.customSounds);

  const selectedTheme = getSetting("sound_theme") ?? "marimba";

  const options: DropdownOption[] = [
    { value: "marimba", label: t("brand.soundCrystal") },
    { value: "pop", label: t("brand.soundFelt") },
    { value: "droplet", label: t("brand.soundDroplet") },
    { value: "silk", label: t("brand.soundSilk") },
    { value: "wood", label: t("brand.soundWood") },
    { value: "orbit", label: t("brand.soundOrbit") },
    { value: "air", label: t("brand.soundAir") },
    { value: "pulse", label: t("brand.soundPulse") },
  ];

  // Only add Custom option if both custom sound files exist
  if (customSounds.start && customSounds.stop) {
    options.push({ value: "custom", label: t("brand.soundCustom") });
  }

  const handlePlayBothSounds = async () => {
    setPlaying(true);
    try {
      await playTestSound("start");
      await playTestSound("stop");
    } finally {
      setPlaying(false);
    }
  };

  return (
    <SettingContainer
      title={label}
      description={description}
      grouped
      layout="horizontal"
    >
      <div className="flex items-center gap-2">
        <Dropdown
          selectedValue={selectedTheme}
          onSelect={(value) =>
            updateSetting("sound_theme", value as SoundTheme)
          }
          options={options}
          disabled={playing || isUpdating("sound_theme")}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePlayBothSounds}
          title={t("brand.soundPreview")}
          aria-label={t("brand.soundPreview")}
          disabled={playing || isUpdating("sound_theme")}
        >
          <PlayIcon className="h-4 w-4" />
        </Button>
      </div>
    </SettingContainer>
  );
};
