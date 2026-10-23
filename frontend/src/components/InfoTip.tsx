import { ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * An ⓘ button with a short explanation. Opens on hover and keyboard focus;
 * a click or tap pins it open (for touch screens) until Escape or a click elsewhere.
 */
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="info-tip"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setHover(false);
          setPinned(false);
        }
      }}
    >
      <button
        type="button"
        className="info-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned(!pinned)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="info-pop">
          {children}
        </span>
      )}
    </span>
  );
}
