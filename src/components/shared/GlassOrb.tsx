import type { CSSProperties } from "react";
import "./GlassOrb.css";

interface GlassOrbProps {
  level?: number;
  state?: "idle" | "arming" | "listening" | "working";
  className?: string;
}

/** Shared, decorative glass material. Audio energy only comes from real mic events. */
export function GlassOrb({
  level = 0,
  state = "idle",
  className = "",
}: GlassOrbProps) {
  const energy = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const style = { "--orb-energy": energy } as CSSProperties;
  return (
    <div
      className={`glass-orb ${className}`}
      data-state={state}
      style={style}
      aria-hidden="true"
    >
      <div className="glass-orb__body">
        <div className="glass-orb__texture" />
        <div className="glass-orb__lava glass-orb__lava--blue" />
        <div className="glass-orb__lava glass-orb__lava--cyan" />
        <div className="glass-orb__depth" />
        <div className="glass-orb__reflection" />
      </div>
      <span className="glass-orb__satellite glass-orb__satellite--one" />
      <span className="glass-orb__satellite glass-orb__satellite--two" />
    </div>
  );
}
