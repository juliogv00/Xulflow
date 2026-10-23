import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cog,
  FlaskConical,
  History,
  Info,
  Sparkles,
  Cpu,
  AudioLines,
  ArrowUpRight,
} from "lucide-react";
import XulFlowLogotype from "./icons/XulFlowLogotype";
import type { AppSettings } from "@/bindings";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: AppSettings | null) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: AudioLines,
    component: GeneralSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside className="app-sidebar">
      <button
        className="brand-lockup"
        onClick={() => onSectionChange("general")}
        aria-label={t("brand.home")}
      >
        <XulFlowLogotype width={52} />
        <span className="brand-lockup__by">{t("brand.byline")}</span>
      </button>
      <span className="sidebar-caption">{t("brand.workspace")}</span>
      <nav className="sidebar-nav" aria-label={t("brand.navigation")}>
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              className={`sidebar-link ${isActive ? "is-active" : ""}`}
              aria-label={t(section.labelKey)}
              title={t(section.labelKey)}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={18} height={18} className="shrink-0" />
              <span>{t(section.labelKey)}</span>
              {isActive && <span className="sidebar-link__dot" />}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-note">
        <span className="sidebar-note__symbol" aria-hidden="true">
          ✳
        </span>
        <p>{t("brand.sidebarNote")}</p>
        <span>
          {t("brand.madeBy")}
          <ArrowUpRight size={12} />
        </span>
      </div>
    </aside>
  );
};
