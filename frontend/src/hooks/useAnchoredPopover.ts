import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Panneau ancré à un bouton, rendu en `position: fixed` via un portail.
 *
 * Le positionnement est **recalculé** sur `resize`, `orientationchange` et défilement,
 * et pas seulement au moment du clic : sans ça, une rotation de l'écran ou l'ouverture
 * du clavier virtuel laissait le panneau décroché de son bouton.
 *
 * Gère aussi la fermeture au clic extérieur et à Échap (avec restitution du focus),
 * logique qui était dupliquée à l'identique dans chaque menu.
 */
export function useAnchoredPopover<T extends HTMLElement = HTMLButtonElement>(
  maxWidth = 340
) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const anchorRef = useRef<T | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(maxWidth, window.innerWidth - margin * 2);
    const top = Math.min(rect.bottom + margin, window.innerHeight - margin);
    const left =
      window.innerWidth < 640
        ? (window.innerWidth - width) / 2
        : Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    setStyle({
      position: "fixed",
      top,
      left,
      width,
      maxHeight: `calc(100vh - ${top + margin}px)`,
      overflowY: "auto",
    });
  }, [maxWidth]);

  // useLayoutEffect : place le panneau avant la peinture, sinon il apparaît une frame
  // en haut à gauche avant de sauter à sa position.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onGeometryChange = () => place();
    window.addEventListener("resize", onGeometryChange);
    window.addEventListener("orientationchange", onGeometryChange);
    window.addEventListener("scroll", onGeometryChange, true);
    return () => {
      window.removeEventListener("resize", onGeometryChange);
      window.removeEventListener("orientationchange", onGeometryChange);
      window.removeEventListener("scroll", onGeometryChange, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      anchorRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
    anchorRef,
    panelRef,
    style,
  };
}
