# Banc d'essai visuel

Rend les vues authentifiées du tableau de bord avec un relevé **entièrement inventé**
(`fixture.ts` : aucun étudiant, aucune note, aucun identifiant réel). C'est ce qui permet de
regarder et de retoucher le design de ces écrans sans identifiants CAS — que ce projet ne
demande, ne journalise et ne stocke jamais.

Hors production : Vite ne construit que `index.html`, donc ni `harness.html` ni ce dossier
n'entrent dans le bundle. À vérifier après toute modification du build :

```bash
grep -rl "Harness\|releveFictif" frontend/dist   # doit ne rien renvoyer
```

## Lancer

```bash
docker run --rm -p 5173:5173 -v "$PWD/frontend:/app" -w /app node:20-alpine \
  sh -c "npm ci && npx vite --host 0.0.0.0"
# puis http://localhost:5173/harness.html
```

Paramètres d'URL : `?theme=dark` force le thème sombre, `?bloc=<nom>` n'affiche qu'un bloc
(`resume`, `simple`, `attente`, `matieres`, `ue`, `absences`, `simulee`) pour une capture ciblée.
