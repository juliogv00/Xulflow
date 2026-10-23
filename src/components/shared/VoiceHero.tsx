import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, Command, Cpu, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { GlassOrb } from "./GlassOrb";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { useModelStore } from "@/stores/modelStore";

export function VoiceHero() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();
  const { currentModel, models } = useModelStore();
  const playTestSound = useSettingsStore((s) => s.playTestSound);
  const [preview, setPreview] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const model = models.find((m) => m.id === currentModel);
  const shortcut = settings?.bindings?.transcribe?.current_binding;
  const previewSound = async () => {
    setPreview((value) => value + 1);
    setPlaying(true);
    try {
      await playTestSound("start");
      await playTestSound("stop");
    } finally {
      if (mounted.current) setPlaying(false);
    }
  };
  return (
    <section className="voice-hero" aria-labelledby="voice-title">
      <div className="voice-hero__main">
        <div className="voice-hero__copy">
          <span className="eyebrow">
            <AudioLines size={13} />
            {t("brand.voiceSpace")}
          </span>
          <h1 id="voice-title">
            {t("brand.heroTitle")}
            <br />
            <span>{t("brand.heroTitleEnd")}</span>
          </h1>
          <p>{t("brand.heroDescription")}</p>
          <div className="voice-hero__shortcut">
            <Command size={14} />
            <span>{t("brand.shortcutHint")}</span>
            <kbd>
              {shortcut
                ? formatKeyCombination(shortcut, osType)
                : t("brand.configureShortcut")}
            </kbd>
          </div>
        </div>
        <div className="voice-hero__visual">
          <div className="voice-hero__orbit" />
          <div className="voice-hero__orb">
            <GlassOrb key={preview} state={playing ? "listening" : "idle"} />
          </div>
          <button
            className="orb-preview"
            onClick={previewSound}
            disabled={playing}
            aria-label={t("brand.previewSound")}
          >
            <Volume2 size={13} />
            {t("brand.previewSound")}
            <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
      <div className="voice-hero__footer">
        <span>
          <Cpu size={13} />
          {model?.name || t("brand.noModel")}
        </span>
        <span>{t("brand.localFirst")}</span>
      </div>
    </section>
  );
}
