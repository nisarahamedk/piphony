import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

interface Question {
  id: string;
  question: string;
  selection?: string;
  timestamp: number;
  answered?: boolean;
  answer?: string;
}

export default function (pi: ExtensionAPI) {
  let server: http.Server | null = null;
  let port = 3456;
  const questions: Map<string, Question> = new Map();
  let currentProjectPath: string | null = null;

  // Find available port
  async function findPort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
      const testServer = http.createServer();
      testServer.listen(startPort, () => {
        testServer.close(() => resolve(startPort));
      });
      testServer.on("error", () => {
        resolve(findPort(startPort + 1));
      });
    });
  }

  // Generate the interactive HTML page
  function generateHTML(projectPath: string, files: { path: string; content: string; explanation?: string }[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Explorer</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-elevated: #21262d;
      --border: #30363d;
      --text: #c9d1d9;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      overflow: hidden;
    }

    /* Sidebar - File Tree */
    .sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 14px;
    }

    .file-tree {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .file-item {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 6px;
      font-size: 13px;
      transition: background 0.15s;
    }

    .file-item:hover { background: var(--surface-elevated); }
    .file-item.active { background: var(--accent); color: #fff; }
    .file-item .icon { margin-right: 8px; opacity: 0.7; }
    .file-item .name { flex: 1; }

    /* Main Content */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .code-viewer {
      flex: 1;
      overflow: auto;
      padding: 16px;
    }

    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .code-title {
      font-size: 16px;
      font-weight: 600;
    }

    .code-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .line {
      display: flex;
      padding: 2px 0;
    }

    .line-number {
      width: 50px;
      color: var(--text-dim);
      text-align: right;
      padding-right: 16px;
      user-select: none;
      flex-shrink: 0;
    }

    .line-content {
      flex: 1;
      cursor: text;
    }

    .line.selected {
      background: rgba(88, 166, 255, 0.15);
      border-left: 3px solid var(--accent);
      margin-left: -3px;
    }

    /* Explanation Panel */
    .explanation-panel {
      border-top: 1px solid var(--border);
      padding: 16px;
      background: var(--surface);
      max-height: 200px;
      overflow-y: auto;
    }

    .explanation-header {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .explanation-content {
      font-size: 14px;
      line-height: 1.6;
    }

    /* Questions Panel */
    .questions-panel {
      width: 320px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .questions-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .questions-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .question-card {
      background: var(--surface-elevated);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .question-card.answered {
      border-left: 3px solid var(--success);
    }

    .question-text {
      font-size: 13px;
      margin-bottom: 8px;
    }

    .question-selection {
      font-size: 11px;
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg);
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 8px;
      max-height: 60px;
      overflow: hidden;
    }

    .question-answer {
      font-size: 12px;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
      padding-top: 8px;
      margin-top: 8px;
    }

    .question-input-container {
      padding: 16px;
      border-top: 1px solid var(--border);
    }

    .question-input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      color: var(--text);
      font-size: 13px;
      resize: none;
      font-family: inherit;
    }

    .question-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .ask-btn {
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .ask-btn:hover { background: var(--accent-hover); }
    .ask-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Empty States */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-dim);
      text-align: center;
      padding: 32px;
    }

    .empty-state .icon { font-size: 48px; margin-bottom: 16px; }
    .empty-state p { font-size: 14px; }

    /* Polling indicator */
    .polling {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: var(--surface-elevated);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .polling .dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">📁 ${path.basename(projectPath)}</div>
    <div class="file-tree" id="fileTree"></div>
  </div>

  <div class="main">
    <div class="code-viewer" id="codeViewer">
      <div class="empty-state">
        <div class="icon">📄</div>
        <p>Select a file to view its contents</p>
      </div>
    </div>
    <div class="explanation-panel" id="explanationPanel">
      <div class="explanation-header">Explanation</div>
      <div class="explanation-content" id="explanationContent">
        Select a file to see its explanation.
      </div>
    </div>
  </div>

  <div class="questions-panel">
    <div class="questions-header">💬 Questions</div>
    <div class="questions-list" id="questionsList"></div>
    <div class="question-input-container">
      <textarea class="question-input" id="questionInput" placeholder="Ask a question about the code..." rows="3"></textarea>
      <button class="ask-btn" id="askBtn">Ask Question</button>
    </div>
  </div>

  <div class="polling" id="polling">
    <div class="dot"></div>
    <span id="pollStatus">Connected</span>
  </div>

  <script>
    const files = ${JSON.stringify(files)};
    let currentFile = null;
    let selectedLines = [];

    // Render file tree
    function renderFileTree() {
      const tree = document.getElementById('fileTree');
      tree.innerHTML = files.map(f => \`
        <div class="file-item \${currentFile === f.path ? 'active' : ''}" onclick="selectFile('\${f.path}')">
          <span class="icon">📄</span>
          <span class="name">\${f.path.split('/').pop()}</span>
        </div>
      \`).join('');
    }

    // Select and display file
    function selectFile(filePath) {
      currentFile = filePath;
      const file = files.find(f => f.path === filePath);
      if (!file) return;

      renderFileTree();

      const viewer = document.getElementById('codeViewer');
      const lines = file.content.split('\\n');

      viewer.innerHTML = \`
        <div class="code-header">
          <div class="code-title">\${filePath}</div>
        </div>
        <div class="code-content">
          \${lines.map((line, i) => \`
            <div class="line" data-line="\${i + 1}">
              <div class="line-number">\${i + 1}</div>
              <div class="line-content" onclick="toggleLine(\${i + 1})">\${escapeHtml(line)}</div>
            </div>
          \`).join('')}
        </div>
      \`;

      // Update explanation
      document.getElementById('explanationContent').textContent = file.explanation || 'No explanation available for this file.';
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function toggleLine(lineNum) {
      const line = document.querySelector(\`.line[data-line="\${lineNum}"]\`);
      if (selectedLines.includes(lineNum)) {
        selectedLines = selectedLines.filter(l => l !== lineNum);
        line.classList.remove('selected');
      } else {
        selectedLines.push(lineNum);
        line.classList.add('selected');
      }
    }

    // Ask question
    async function askQuestion() {
      const input = document.getElementById('questionInput');
      const btn = document.getElementById('askBtn');
      const question = input.value.trim();
      if (!question) return;

      btn.disabled = true;
      btn.textContent = 'Sending...';

      const selection = selectedLines.length > 0 ? \`Lines \${selectedLines.join(', ')} in \${currentFile}\` : currentFile;

      try {
        const res = await fetch('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, selection, file: currentFile })
        });

        if (res.ok) {
          input.value = '';
          selectedLines = [];
          pollQuestions();
        }
      } catch (e) {
        console.error(e);
      }

      btn.disabled = false;
      btn.textContent = 'Ask Question';
    }

    document.getElementById('askBtn').addEventListener('click', askQuestion);
    document.getElementById('questionInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) askQuestion();
    });

    // Poll for questions/answers
    async function pollQuestions() {
      try {
        const res = await fetch('/api/questions');
        const data = await res.json();
        renderQuestions(data.questions);
      } catch (e) {
        console.error('Poll error:', e);
      }
    }

    function renderQuestions(questions) {
      const list = document.getElementById('questionsList');
      if (questions.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No questions yet. Ask one above!</p></div>';
        return;
      }

      list.innerHTML = questions.map(q => \`
        <div class="question-card \${q.answered ? 'answered' : ''}">
          <div class="question-text">\${escapeHtml(q.question)}</div>
          \${q.selection ? \`<div class="question-selection">\${escapeHtml(q.selection)}</div>\` : ''}
          \${q.answer ? \`<div class="question-answer">\${escapeHtml(q.answer)}</div>\` : ''}
        </div>
      \`).join('');
    }

    // Initial render
    renderFileTree();
    if (files.length > 0) selectFile(files[0].path);

    // Poll every 2 seconds
    setInterval(pollQuestions, 2000);
  </script>
</body>
</html>`;
  }

  // Simple request handler
  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!currentProjectPath) {
        res.writeHead(404);
        res.end("No project loaded");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("Loading...");
      return;
    }

    if (url.pathname === "/api/questions") {
      if (req.method === "GET") {
        const allQuestions = Array.from(questions.values());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ questions: allQuestions }));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const id = `q_${Date.now()}`;
            const q: Question = {
              id,
              question: data.question,
              selection: data.selection,
              timestamp: Date.now(),
            };
            questions.set(id, q);

            // Notify user in pi
            pi.sendMessage({
              customType: "code-explorer",
              content: `**New question:** ${data.question}\n\n*Context:* ${data.selection || data.file || "general"}`,
              display: true,
            });

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, id }));
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  }

  // Start server
  async function startServer(projectPath: string) {
    port = await findPort(3456);
    currentProjectPath = projectPath;

    server = http.createServer(handleRequest);
    server.listen(port, () => {
      console.log(`Code Explorer server running at http://localhost:${port}`);
    });

    // Open in browser
    const { exec } = await import("node:child_process");
    exec(`open http://localhost:${port}`);
  }

  // Register /explore command
  pi.registerCommand("explore", {
    description: "Open interactive code explorer in browser",
    handler: async (args, ctx) => {
      // Get current working directory or use provided path
      const projectPath = args || ctx.cwd;

      // Scan for TypeScript files in src/
      const srcPath = path.join(projectPath, "src");
      const files: { path: string; content: string; explanation?: string }[] = [];

      function scanDir(dir: string) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.name.endsWith(".ts") && !entry.name.includes(".d.ts")) {
            const relPath = path.relative(projectPath, fullPath);
            const content = fs.readFileSync(fullPath, "utf-8");
            // Simple explanation based on file name
            const explanation = getExplanation(relPath);
            files.push({ path: relPath, content, explanation });
          }
        }
      }

      function getExplanation(filePath: string): string {
        const name = path.basename(filePath, ".ts");
        const explanations: Record<string, string> = {
          "orchestrator": "The main orchestration engine that polls trackers for work items and dispatches them to workers.",
          "types": "Core type definitions including WorkItem, TrackerAdapter, RuntimeProvider, and RunWorker interfaces.",
          "active-run-registry": "Tracks currently active runs and their metadata.",
          "adapter": "Implements the TrackerAdapter interface for a local file-based issue tracker.",
          "state": "Manages the local tracker state including work items, comments, and artifacts.",
          "logger": "Handles logging for runs, including writing summary.json and transcript.json files.",
          "index": "Entry point and exports for the module.",
        };
        return explanations[name] || `Source file: ${name}`;
      }

      scanDir(srcPath);

      if (files.length === 0) {
        ctx.ui.notify("No TypeScript files found in src/", "error");
        return;
      }

      await startServer(projectPath);

      // Send the HTML with files
      ctx.ui.notify(`Code Explorer opened at http://localhost:${port}`, "info");

      // Wait a moment then serve the HTML
      setTimeout(() => {
        if (server) {
          server.removeAllListeners("request");
          server.on("request", (req, res) => {
            const url = new URL(req.url || "/", `http://localhost:${port}`);

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");

            if (req.method === "OPTIONS") {
              res.writeHead(204);
              res.end();
              return;
            }

            if (url.pathname === "/" || url.pathname === "/index.html") {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(generateHTML(projectPath, files));
              return;
            }

            // API routes as before...
            if (url.pathname === "/api/questions") {
              if (req.method === "GET") {
                const allQuestions = Array.from(questions.values());
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ questions: allQuestions }));
                return;
              }

              if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                  try {
                    const data = JSON.parse(body);
                    const id = `q_${Date.now()}`;
                    const q: Question = {
                      id,
                      question: data.question,
                      selection: data.selection,
                      timestamp: Date.now(),
                    };
                    questions.set(id, q);

                    pi.sendMessage({
                      customType: "code-explorer",
                      content: `**Question:** ${data.question}\n\n*Context:* ${data.selection || data.file || "general"}`,
                      display: true,
                    });

                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, id }));
                  } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                  }
                });
                return;
              }
            }

            res.writeHead(404);
            res.end("Not found");
          });
        }
      }, 500);
    },
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    if (server) {
      server.close();
      server = null;
    }
  });
}