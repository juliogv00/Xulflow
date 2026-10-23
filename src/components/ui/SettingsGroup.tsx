import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="settings-group space-y-3">
      {title && (
        <div className="settings-group__heading">
          <h2 className="text-xs font-normal text-mid-gray uppercase tracking-widest">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-mid-gray mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="glass-panel overflow-visible">
        <div className="divide-y divide-black/5">{children}</div>
      </div>
    </div>
  );
};
