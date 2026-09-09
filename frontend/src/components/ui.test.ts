import { describe, expect, it, vi } from "vitest";
import { activationHandler } from "./ui";

/** Événement clavier minimal : le gestionnaire ne lit que key, target et currentTarget. */
function evenement(key: string, options: { depuisUnChamp?: boolean } = {}) {
  const ligne = { nom: "ligne" };
  const champ = { closest: (sel: string) => (/input|textarea|select|button|a/.test(sel) ? {} : null) };
  return {
    key,
    target: options.depuisUnChamp ? champ : ligne,
    currentTarget: ligne,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("activation d'un role=button porté par un div", () => {
  it("s'active à Entrée et à la barre d'espace, comme l'exige l'ARIA", () => {
    // Régression : seul Entrée était géré, donc Espace faisait défiler la page au lieu
    // de déplier la ligne.
    for (const key of ["Enter", " "]) {
      const action = vi.fn();
      const event = evenement(key);
      activationHandler(action)(event);
      expect(action, key).toHaveBeenCalledTimes(1);
      expect(event.preventDefault, key).toHaveBeenCalled();
    }
  });

  it("ignore les autres touches, sans bloquer leur comportement par défaut", () => {
    for (const key of ["a", "Tab", "ArrowDown", "Escape"]) {
      const action = vi.fn();
      const event = evenement(key);
      activationHandler(action)(event);
      expect(action, key).not.toHaveBeenCalled();
      expect(event.preventDefault, key).not.toHaveBeenCalled();
    }
  });

  it("ne détourne pas les touches destinées à un champ imbriqué", () => {
    // Ces lignes contiennent les champs de saisie des notes simulées : sans ce filtre,
    // une espace tapée dans un champ repliait la ligne.
    for (const key of ["Enter", " "]) {
      const action = vi.fn();
      const event = evenement(key, { depuisUnChamp: true });
      activationHandler(action)(event);
      expect(action, key).not.toHaveBeenCalled();
      expect(event.preventDefault, key).not.toHaveBeenCalled();
    }
  });
});
