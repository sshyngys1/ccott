import { motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IconCheck, IconChevronDown, IconSpeaker, IconVolume, IconVolumeMute } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { VOLUME_WHEEL_STEP, WheelDeltaAccumulator, useAudio } from "../../lib/audio/store";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function VolumeCard() {
  const { audio, ready, devices, setVolume, stepVolume, toggleMute, loadDevices, setDevice } = useAudio();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wheelRef = useRef(new WheelDeltaAccumulator());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const stepVolumeRef = useRef(stepVolume);
  stepVolumeRef.current = stepVolume;

  const { volume, muted, device } = audio;
  const selectedIndex = Math.max(0, devices.findIndex((d) => d.id === device?.id));
  const [focused, setFocused] = useState(0);

  useEffect(() => {
    if (menuOpen) optionRefs.current[selectedIndex]?.focus();
  }, [menuOpen, devices.length, selectedIndex]);

  // Mouse wheel / touchpad over the volume card adjusts volume by ±2% per step and prevents panel scrolling.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const accumulator = wheelRef.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!readyRef.current) return;
      const steps = accumulator.consume(e.deltaY, e.deltaMode);
      if (steps !== 0) {
        stepVolumeRef.current(steps * VOLUME_WHEEL_STEP);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      accumulator.reset();
    };
  }, []);

  const chooseDevice = (id: string) => {
    void setDevice(id);
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  // Device menu: closes on outside click and on Escape (Escape is consumed so the island does not collapse).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen) void loadDevices();
    setMenuOpen((o) => !o);
  };

  return (
    <section ref={rootRef} className="ig-glass-card hm-volume" aria-label="Громкость">
      <motion.button
        type="button"
        className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
        {...tap}
        aria-pressed={muted}
        aria-label={muted ? "Включить звук" : "Выключить звук"}
        disabled={!ready}
        onClick={() => void toggleMute()}
      >
        {muted ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
      </motion.button>
      <input
        className="ig-glass-slider ig-glass-slider--accent"
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume}
        data-muted={muted}
        disabled={!ready}
        onChange={(e) => setVolume(Number(e.target.value))}
        style={{ "--ig-value": `${volume}%` } as CSSProperties}
        aria-label="Громкость"
        aria-valuetext={muted ? "Без звука" : `${volume}%`}
      />
      <span className="hm-vol-value ig-num" data-muted={muted}>
        {muted ? "Без звука" : `${volume}%`}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="ig-glass-control hm-device"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? "hm-output-devices" : undefined}
        title={device?.name ?? "Устройство вывода"}
        onClick={toggleMenu}
      >
        <IconSpeaker size={16} />
        <span>{device?.name ?? "Устройство"}</span>
        <IconChevronDown size={14} />
      </button>
      {menuOpen && (
        <ul id="hm-output-devices" className="ig-glass hm-menu" role="listbox" aria-label="Устройство вывода">
          {devices.length === 0 && <li className="mod-caption" style={{ padding: "var(--ig-space-2)" }}>Устройства не найдены</li>}
          {devices.map((d, index) => {
            const current = d.id === device?.id;
            return (
              <li key={d.id} role="presentation">
                <button
                  ref={(el) => { optionRefs.current[index] = el; }}
                  type="button"
                  role="option"
                  aria-selected={current}
                  title={d.name}
                  tabIndex={index === focused ? 0 : -1}
                  data-island-keyboard="true"
                  className="ig-glass-control ig-glass-control--ghost ig-glass-control--sm"
                  onFocus={() => setFocused(index)}
                  onClick={() => chooseDevice(d.id)}
                  onKeyDown={(e) => {
                    let next = index;
                    if (e.key === "ArrowDown") next = (index + 1) % devices.length;
                    else if (e.key === "ArrowUp") next = (index - 1 + devices.length) % devices.length;
                    else if (e.key === "Home") next = 0;
                    else if (e.key === "End") next = devices.length - 1;
                    else if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      chooseDevice(d.id);
                      return;
                    } else return;
                    e.preventDefault();
                    optionRefs.current[next]?.focus();
                  }}
                >
                  {current ? <IconCheck size={14} /> : <IconSpeaker size={14} />}
                  <span className="ig-truncate">{d.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
