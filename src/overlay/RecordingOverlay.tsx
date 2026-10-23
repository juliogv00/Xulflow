import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { GlassOrb } from "@/components/shared/GlassOrb";
import { commands, events } from "@/bindings";
import type {
  StreamPhase,
  StreamPhaseEvent,
  StreamTextEvent,
  StreamWorkKind,
} from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState = "recording" | "streaming" | "transcribing" | "processing";

// Number of reactive bars in the waveform (the simple, smoothed style shared by
// every overlay form). Mic levels arrive as 16 FFT buckets; we take the first N.
const WAVE_BARS = 9;

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  // `Stream::play()` returning does not mean hardware callbacks are flowing.
  // Stay visually in an arming state until the backend processes the first
  // actual microphone sample chunk.
  const [captureReady, setCaptureReady] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(WAVE_BARS).fill(0));
  const [streamText, setStreamText] = useState<StreamTextEvent>({
    committed: "",
    tentative: "",
  });
  const [phase, setPhase] = useState<StreamPhase>("listening");
  const [workKind, setWorkKind] = useState<StreamWorkKind>("transcribing");
  const [elapsed, setElapsed] = useState(0);
  // Remount the orb once per recording to replay its assembly animation.
  const [session, setSession] = useState(0);
  // Live text sits below a top orb and above a bottom orb.
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  // Highlight the transcript edge when older text is available by scrolling.
  const [overflowing, setOverflowing] = useState(false);

  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  // Live-text scroll-back: the text region "sticks" to the newest line while the
  // user is at the bottom; if they scroll up to read history, auto-follow pauses
  // until they scroll back down.
  const capRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const setupEventListeners = async () => {
      const unlistenShow = await listen("show-overlay", async (event) => {
        if (disposed) return;
        const currentGeneration = ++generation;
        const overlayState = event.payload as OverlayState;
        // Reset synchronously before settings I/O. A fast microphone can emit
        // recording-ready while the awaits below are in flight; resetting after
        // them would overwrite that event and leave the overlay stuck arming.
        if (overlayState === "recording" || overlayState === "streaming") {
          setCaptureReady(false);
          smoothedLevelsRef.current = Array(16).fill(0);
          setLevels(Array(WAVE_BARS).fill(0));
          setStreamText({ committed: "", tentative: "" });
        }

        setState(overlayState);
        setIsMounted(true);
        if (overlayState === "recording" || overlayState === "streaming") {
          setPhase("listening");
          setWorkKind("transcribing");
          setElapsed(0);
          setSession((s) => s + 1); // remount the card fresh for this session
        }
        setIsVisible(true);

        await syncLanguageFromSettings();
        // The Live panel flows downward from a top overlay and upward from a
        // bottom one; read the placement so the layout can flip to match.
        try {
          const settings = await commands.getAppSettings();
          if (
            !disposed &&
            currentGeneration === generation &&
            settings.status === "ok"
          ) {
            setPosition(
              settings.data.overlay_position === "top" ? "top" : "bottom",
            );
          }
        } catch {
          // Keep the previous/default placement if settings can't be read.
        }
      });

      const unlistenHide = await listen("hide-overlay", () => {
        generation += 1;
        setIsVisible(false);
        setCaptureReady(false);
      });

      const unlistenReady = await listen("recording-ready", () => {
        setElapsed(0);
        setCaptureReady(true);
      });

      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];
        // Exponential smoothing across the 16 buckets, then take the first N
        // bars for the shared waveform.
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3;
        });
        smoothedLevelsRef.current = smoothed;
        setLevels(smoothed.slice(0, WAVE_BARS));
      });

      const unlistenStream = await events.streamTextEvent.listen((event) => {
        setStreamText(event.payload);
      });

      const unlistenPhase = await events.streamPhaseEvent.listen((event) => {
        const payload: StreamPhaseEvent = event.payload;
        setPhase(payload.phase);
        if (payload.kind) setWorkKind(payload.kind);
      });

      return () => {
        unlistenShow();
        unlistenHide();
        unlistenReady();
        unlistenLevel();
        unlistenStream();
        unlistenPhase();
      };
    };

    const cleanup = setupEventListeners();
    return () => {
      disposed = true;
      generation += 1;
      void cleanup.then((unlisten) => unlisten());
    };
  }, []);

  // Keep the material mounted for the native window's 300 ms exit grace period.
  useEffect(() => {
    if (isVisible) return;
    const timeout = setTimeout(() => setIsMounted(false), 260);
    return () => clearTimeout(timeout);
  }, [isVisible]);

  // Elapsed capture timer starts only once microphone samples are flowing.
  useEffect(() => {
    if (
      (state !== "streaming" && state !== "recording") ||
      !isVisible ||
      !captureReady ||
      phase === "working"
    )
      return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state, isVisible, captureReady, phase]);

  // Stick to the bottom as text streams in — but only while pinned, so a user who
  // has scrolled up to read history isn't yanked back down by the next chunk.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    // Signal overflow only once text exceeds the scrollable transcript.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  // Each fresh streaming session starts pinned to the bottom, fade cleared.
  useEffect(() => {
    pinnedRef.current = true;
    setOverflowing(false);
  }, [session]);

  if (!isMounted) return null;

  // Re-pin when the user is within ~a line of the bottom; unpin otherwise.
  const handleStreamScroll = () => {
    const el = capRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 16;
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const working =
    state === "transcribing" ||
    state === "processing" ||
    (state === "streaming" && phase === "working");
  const hasText =
    state === "streaming" &&
    Boolean(streamText.committed || streamText.tentative);
  const label = working
    ? t(
        state === "processing" ||
          (state === "streaming" && workKind === "polishing")
          ? "overlay.processing"
          : "overlay.transcribing",
      )
    : t(captureReady ? "brand.listening" : "brand.arming");
  const energy =
    captureReady && !working
      ? levels.reduce((sum, value) => sum + value, 0) / levels.length
      : 0;

  return (
    <div
      dir={direction}
      className={`ov-stage ${position} ${isVisible ? "show" : "leaving"}`}
    >
      <div className={`orb-overlay ${hasText ? "has-transcript" : ""}`}>
        <div className="orb-controls">
          <div className="recording-orb" key={session}>
            <GlassOrb
              state={
                working ? "working" : captureReady ? "listening" : "arming"
              }
              level={energy}
            />
          </div>
          <button
            className="orb-cancel"
            aria-label={t("tray.cancel")}
            title={t("tray.cancel")}
            onClick={() => commands.cancelOperation()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4 L12 12 M12 4 L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="orb-status" role="status">
          <span>{label}</span>
          {captureReady && !working && <time>{fmtTime(elapsed)}</time>}
        </div>
        {hasText && (
          <div
            className={`orb-transcript ${overflowing ? "overflowing" : ""}`}
            ref={capRef}
            onScroll={handleStreamScroll}
          >
            <p>
              <span>
                {streamText.committed ? streamText.committed + " " : ""}
              </span>
              <span className="tentative">{streamText.tentative}</span>
              {!working && <span className="orb-caret" />}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordingOverlay;
