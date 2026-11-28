# 🎓 MEHDI 2.0 — AI teaching assistant

![DevSecOps](https://github.com/ikram856/agent-prof/actions/workflows/devsecops.yml/badge.svg)

A classroom assistant that helps middle-school students during a lesson. The teacher provides the course material; the assistant answers in simple, encouraging French, guides students with questions instead of giving answers, and stays focused on the course.

## Features

- **Accounts** — one teacher account + one personal account per student (identifier + generated password, printable login cards, CSV export, password reset)
- **Session summaries** — one button: the student gets "what I learned", the teacher gets a teaching report; the teacher can also summarize a whole class session (all questions of the day)
- **Questions / Debate / Quiz** — three modes; the debate starts right away with a question taken from the course
- **History** — every conversation is saved on the server; the teacher sees all students' conversations, each student sees their own
- **Course summaries** — AI-drafted summary + mind map per lesson, edited by the teacher, exported as a signed PDF
- **Course upload** — PDF, PowerPoint `.pptx`, text, web links, or **photos** (textbook pages, diagrams: the AI transcribes the text and describes the figures); several sources can be combined in one lesson, and each lesson can be assigned to a class
- **Streaming answers** — replies appear word by word and keep going even if the page is reloaded
- **Classroom tools** — projection mode, POUR / CONTRE poll, speaking timer, voice dictation

## Security (DevSecOps)

Every push runs the [DevSecOps pipeline](.github/workflows/devsecops.yml):

| Stage | Tool |
|---|---|
| Secret scanning (full Git history) | Gitleaks |
| Dependency vulnerabilities & signatures | npm audit, Dependabot |
| Automated tests (access control, CSRF, SSRF, path traversal…) | `node:test` + mock Gemini |
| Static analysis (SAST) | Semgrep — JavaScript, Node.js, OWASP Top 10 |
| Dynamic analysis (DAST) | OWASP ZAP baseline |

Details of the protections (scrypt passwords, strict CSP with script hashes, SameSite cookies, SSRF guard, rate limiting…) are in [SECURITY.md](SECURITY.md).

## Stack

- Node.js (ES modules, no framework) — `server.mjs`
- Google Gemini API (streaming, automatic fallback between models)
- `unpdf` and `jszip` to extract text from course files
- Vanilla HTML / CSS / JS front end in `public/`

## Run locally

```bash
git clone https://github.com/ikram856/agent-prof.git
cd agent-prof
npm ci
cp .env.example .env      # then put your Gemini key in .env (never commit it)
npm start
```

Open http://localhost:3000. On first launch you create the teacher password, then add classes and their students in **⚙️ Espace prof**.
Students on the same Wi-Fi use the computer's local address, e.g. `http://192.168.1.25:3000`.

## Tests

```bash
npm test
```

The tests start the server in a temporary folder with a fake Gemini API: no key needed, no real data touched.

## Project structure

```
agent-prof/
├── .github/
│   ├── workflows/devsecops.yml   # security pipeline
│   └── dependabot.yml            # weekly dependency updates
├── .zap/rules.tsv                # OWASP ZAP rules
├── public/
│   ├── login.html                # login (teacher / class + first name)
│   ├── index.html                # lesson: questions / debate / quiz
│   ├── historique.html           # conversation history
│   ├── resumes.html              # course summaries + mind map + PDF
│   ├── prof.html                 # teacher area: classes, signature, lessons
│   └── common.js / common.css    # shared code and styles
├── test/                         # automated tests + mock Gemini
├── instructions.txt              # system prompt (tone and rules for the assistant)
├── server.mjs                    # HTTP server, accounts, history, Gemini calls
├── .env.example                  # configuration template
└── SECURITY.md
```

`cours/` (lessons) and `data/` (accounts, conversations, signature) stay on the school computer and are never committed.

## Author

Ikram Ezziouani — [GitHub](https://github.com/ikram856)
