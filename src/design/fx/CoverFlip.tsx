// Owner: motion-fx. Artwork that hops and turns 360° around X when the track changes. Spec: docs/design-spec.md §9b.1.
//
// Two faces, each its own `rotateX` (front θ, back θ + 180°) with `backface-visibility: hidden`, under one lift layer
// (translateY + scale). All of it runs on motion values: the component re-renders only when a face swaps its track
// (≤ 2 times per turn), never per frame. At rest the back face and the lift shadow are not in the DOM and every
// transform is `none`.
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconMusic } from "../icons";
import { coverFlip } from "../motion";
import type { MediaState } from "../../shared/types";
import { coverOf, flipDuration, flipTarget, frontHidden, shouldFlip, takeSkipDirection, type Cover } from "./flip";
import "./coverFlip.css";

type Faces = { front: Cover; back: Cover };

export function CoverFlip({ media, className }: { media: MediaState; className: string }) {
  const reduce = useReducedMotion();
  const latest = coverOf(media);
  const latestRef = useRef(latest);
  const theta = useMotionValue(0);
  const lift = useMotionValue(0);
  const backTheta = useTransform(theta, (v) => v + 180);
  const y = useTransform(lift, [0, 1], [0, coverFlip.lift.y]);
  const scale = useTransform(lift, [0, 1], [1, coverFlip.lift.scale]);
  // null = at rest: one face showing the current track.
  const [faces, setFacesState] = useState<Faces | null>(null);
  const facesRef = useRef<Faces | null>(null);
  const setFaces = useCallback((next: Faces | null) => {
    if (next === facesRef.current) return;
    facesRef.current = next;
    setFacesState(next);
  }, []);
  const prevMedia = useRef<MediaState | null>(null);
  const run = useRef<{ rot: AnimationPlaybackControls; hop: AnimationPlaybackControls } | null>(null);

  // The face turned away from the viewer takes the newest track, so nothing older than it is ever seen again.
  const swapHidden = useCallback((angle: number) => {
    const f = facesRef.current;
    const l = latestRef.current;
    if (!f) return;
    if (frontHidden(angle)) {
      if (f.front.id !== l.id) setFaces({ ...f, front: l });
    } else if (f.back.id !== l.id) setFaces({ ...f, back: l });
  }, [setFaces]);
  useMotionValueEvent(theta, "change", swapHidden);

  useLayoutEffect(() => {
    latestRef.current = coverOf(media);
    const before = prevMedia.current;
    prevMedia.current = media;
    if (!before || !shouldFlip(before, media)) {
      swapHidden(theta.get());
      return;
    }
    const dir = takeSkipDirection();
    if (reduce) return; // the front face cross-fades to the new cover
    const from = theta.get();
    const to = flipTarget(from, dir);
    const midAir = run.current !== null;
    run.current?.rot.stop();
    run.current?.hop.stop();
    if (midAir) swapHidden(from);
    else setFaces({ front: coverOf(before), back: latestRef.current });
    const duration = flipDuration(from, to, coverFlip.duration);
    const rot = animate(theta, to, { duration, ease: midAir ? coverFlip.retargetEase : coverFlip.ease });
    const hop = animate(lift, [lift.get(), 1, 0], { duration, times: [0, coverFlip.lift.peak, 1], ease: ["easeOut", "easeInOut"] });
    const current = { rot, hop };
    run.current = current;
    void rot.then(() => {
      if (run.current !== current) return;
      run.current = null;
      theta.jump(0);
      lift.jump(0);
      setFaces(null);
    });
  }, [media, reduce, theta, lift, swapHidden, setFaces]);

  useEffect(
    () => () => {
      run.current?.rot.stop();
      run.current?.hop.stop();
      run.current = null;
    },
    [],
  );

  // A late artwork for a track a face already shows is picked up right away (cross-fade, no flip).
  const resolve = (c: Cover) => (c.id === latest.id ? latest : c);
  return (
    <span className="fx-flip" data-flipping={faces !== null} aria-hidden="true">
      <motion.span className="fx-flip-lift" style={{ y, scale, perspective: faces ? coverFlip.perspective : undefined }}>
        {faces && <motion.span className="fx-flip-shadow" style={{ opacity: lift }} />}
        <motion.span className={`${className} fx-flip-face`} style={{ rotateX: theta }}>
          <CoverArt cover={faces ? resolve(faces.front) : latest} fade />
        </motion.span>
        {faces && (
          <motion.span className={`${className} fx-flip-face`} style={{ rotateX: backTheta }} data-face="back">
            <CoverArt cover={resolve(faces.back)} />
          </motion.span>
        )}
      </motion.span>
    </span>
  );
}

function CoverArt({ cover, fade = false }: { cover: Cover; fade?: boolean }) {
  const art = cover.artwork ? <img src={cover.artwork} alt="" draggable={false} /> : <IconMusic size={32} />;
  if (!fade) return <span className="fx-flip-art">{art}</span>;
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={`${cover.id}\n${cover.artwork ?? ""}`}
        className="fx-flip-art"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={coverFlip.fade}
      >
        {art}
      </motion.span>
    </AnimatePresence>
  );
}
