# 🎓 agent-prof — AI teaching assistant

A classroom assistant that helps middle-school students during a lesson. The teacher provides the course material; the assistant answers in simple, encouraging French and stays focused on that course.

## Features

- **Questions** — students ask about the lesson and get short, clear explanations
- **Debate** — the assistant takes a position and makes students argue
- **Quiz** — generated questions to check understanding
- **Course upload** — reads the teacher's material (PDF, PowerPoint `.pptx`, text)
- **History** — the conversation is kept when switching mode or window

## Stack

- Node.js (ES modules, no framework) — `server.mjs`
- Google Gemini API
- `unpdf` and `jszip` to extract text from course files
- Vanilla HTML / JS front end in `public/`

## Run locally

```bash
git clone https://github.com/ikram856/agent-prof.git
cd agent-prof
npm install
```

Set your Gemini key as an environment variable (never commit it):

```bash
# Linux / macOS
export GEMINI_API_KEY="your-key"
# Windows PowerShell
$env:GEMINI_API_KEY="your-key"
```

Then:

```bash
npm start
```

and open http://localhost:3000 (or the port set in `PORT`).

## Project structure

```
agent-prof/
├── public/
│   ├── index.html       # interface (questions / debate / quiz)
│   └── historique.js    # conversation history
├── instructions.txt     # system prompt (tone and rules for the assistant)
├── server.mjs           # HTTP server + Gemini calls
└── package.json
```

## Author

Ikram Ezziouani — [GitHub](https://github.com/ikram856)
