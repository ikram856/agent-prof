# Sécurité de MEHDI 2.0

MEHDI 2.0 est utilisé par des élèves mineurs : il gère des mots de passe, des conversations d'élèves et une clé d'API payante. La sécurité est donc vérifiée **automatiquement à chaque modification** (démarche DevSecOps).

## Signaler une faille

Merci de **ne pas ouvrir d'issue publique**. Écris directement à la mainteneuse du dépôt (Ikram Ezziouani, via GitHub) en décrivant le problème et comment le reproduire.

## Le pipeline DevSecOps

Le fichier `.github/workflows/devsecops.yml` se lance à chaque `push`, à chaque pull request et chaque lundi.

| Étape | Outil | Ce qui est vérifié |
|---|---|---|
| 🔑 Secrets | Gitleaks | Aucune clé ni mot de passe dans le code ni dans **tout l'historique** Git (règle ajoutée pour les clés Gemini au format `AQ.`) |
| 📦 Dépendances | npm audit, `npm audit signatures`, Dependabot | Failles connues dans `jszip` / `unpdf`, signatures des paquets, mises à jour proposées chaque semaine |
| 🧪 Tests | `node:test` + faux Gemini | 32 tests : comptes élèves individuels, résumés de séance, photos de cours (vrai type vérifié), droits élève / prof, cloisonnement des classes, CSRF, SSRF, traversée de dossier, plantage, déconnexion… |
| 🔍 SAST | Semgrep (règles JavaScript, Node.js, OWASP Top 10) | Injection, XSS, chemins de fichiers dangereux dans le code |
| 🛡️ DAST | OWASP ZAP (baseline) | Le serveur lancé pour de vrai : en-têtes, cookies, fuite d'informations |

Les rapports Semgrep et ZAP sont téléchargeables dans l'onglet **Actions** de GitHub (section *Artifacts*).

## Protections dans l'application

- **Mots de passe** hachés avec `scrypt` + sel aléatoire, comparaison en temps constant.
- **Comptes élèves** : un identifiant et un mot de passe par élève, générés au hasard (`crypto.randomInt`), stockés seulement sous forme de hachage scrypt ; montrés une seule fois au prof. Un nouveau mot de passe ou la suppression du compte ferme immédiatement les sessions de l'élève. Message d'erreur identique que l'identifiant existe ou non.
- **Sessions** : cookie `HttpOnly`, `SameSite=Strict` (et `Secure` + HSTS avec `COOKIE_SECURE=1` en HTTPS), expiration 12 h (élève) / 7 jours (prof).
- **Force brute** : 10 essais ratés en 10 minutes bloquent le compte visé, sans bloquer le reste de la classe (même adresse IP).
- **Contrôle d'accès** vérifié côté serveur pour chaque route : un élève ne voit que ses conversations et les leçons de sa classe.
- **CSRF** : cookie `SameSite=Strict` + refus des requêtes venant d'une autre origine.
- **XSS** : tout le texte est inséré avec `textContent` ; **Content-Security-Policy** stricte où les scripts sont autorisés par leur empreinte SHA-256.
- **Autres en-têtes** : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- **SSRF** : l'import par liens refuse les adresses internes (PC, réseau local, `169.254.169.254`…), les ports autres que 80/443 et vérifie chaque redirection.
- **Fichiers** : protection contre la traversée de dossier, tailles limitées, signature acceptée uniquement en PNG.
- **Injection de prompt** : le cours et les notes sont transmis à l'IA comme des *données*, jamais comme des instructions ; les élèves ne peuvent pas modifier les notes du prof.
- **Données des élèves** : stockées uniquement sur le serveur de l'établissement (`data/`), jamais envoyées sur GitHub (`.gitignore`).

## Limites connues

- L'application est prévue pour un **réseau local d'établissement**. Pour la mettre sur Internet, il faut un HTTPS (reverse proxy) et `COOKIE_SECURE=1`.
- La protection SSRF vérifie l'adresse avant chaque requête ; une attaque par *DNS rebinding* très rapide reste théoriquement possible. L'import par liens est réservé au professeur.
- `style-src 'unsafe-inline'` reste autorisé dans la CSP (styles écrits dans les pages) ; les scripts, eux, sont strictement contrôlés.

## Bonnes pratiques pour le professeur

- Ne jamais pousser le fichier `.env` (il est ignoré par Git) ; partir de `.env.example`.
- Si une clé Gemini a été exposée : la **supprimer** dans Google AI Studio et en créer une nouvelle.
- En fin d'année, supprimer les classes (cela supprime les comptes de leurs élèves) ; donner un nouveau mot de passe à un élève dont le mot de passe a circulé.
