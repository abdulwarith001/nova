/**
 * computer/tools.ts — Native computer access tools.
 *
 * Tools: shell_exec, shell_session_start/exec/end,
 *        file_read, file_write, file_list,
 *        process_list, process_kill, system_info
 */

import { exec, spawn, type ChildProcess } from "child_process";
import { pushPendingImage } from "../../../runtime/src/pending-images.js";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "fs";
import { join, resolve, dirname, basename } from "path";
import {
  homedir,
  platform,
  arch,
  cpus,
  totalmem,
  freemem,
  hostname,
  uptime,
  networkInterfaces,
  type,
} from "os";

// ── Safety ──────────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /rm\s+(-[rf]+\s+)?\/($|\s)/i, // rm -rf / (root deletion)
  /mkfs/i, // format disk
  /dd\s+if=/i, // disk destroyer
  />\s*\/dev\//, // write to devices
  /:()\s*\{.*\|.*&\s*\}.*;/, // fork bombs
  /\b(shutdown|reboot|halt|poweroff)\b/i, // system control
  /chmod\s+(-R\s+)?777\s+\//i, // root chmod 777
  /curl.*\|\s*(bash|sh|zsh)/i, // pipe to shell
  /launchctl\s+(unload|remove)/i, // remove launch daemons
  /diskutil\s+(erase|unmount)/i, // disk operations
];

const MAX_OUTPUT_BYTES = 10_240; // 10KB
const MAX_SESSIONS = 5;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000; // 30 min

function isBlocked(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked for safety: matches pattern ${pattern}. If you really need this, ask the user to run it manually.`;
    }
  }
  return null;
}

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return resolve(p);
}

function truncateOutput(
  output: string,
  maxBytes = MAX_OUTPUT_BYTES,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(output, "utf-8") <= maxBytes) {
    return { text: output, truncated: false };
  }
  // Keep first and last portions
  const halfBytes = Math.floor(maxBytes / 2);
  const first = output.slice(0, halfBytes);
  const last = output.slice(-halfBytes);
  return {
    text: `${first}\n\n[...truncated ${Buffer.byteLength(output, "utf-8") - maxBytes} bytes...]\n\n${last}`,
    truncated: true,
  };
}

// ── Session Manager ─────────────────────────────────────────────────────────

interface ShellSession {
  id: string;
  process: ChildProcess;
  cwd: string;
  createdAt: number;
  lastUsedAt: number;
}

const sessions = new Map<string, ShellSession>();
let sessionCounter = 0;

// Periodic cleanup of idle sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
      session.process.kill();
      sessions.delete(id);
      console.log(`🧹 Cleaned up idle shell session: ${id}`);
    }
  }
}, 60_000);

function execInSession(
  session: ShellSession,
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const marker = `__NOVA_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          stdout: truncateOutput(stdout).text,
          stderr: "Command timed out",
          exitCode: 124,
        });
      }
    }, timeoutMs);

    const onStdout = (data: Buffer) => {
      const str = data.toString();
      if (str.includes(marker)) {
        // Parse exit code from marker line
        const lines = (stdout + str).split("\n");
        stdout = "";
        let exitCode = 0;
        for (const line of lines) {
          if (line.includes(marker)) {
            const match = line.match(new RegExp(`${marker}:(\\d+)`));
            exitCode = match ? parseInt(match[1], 10) : 0;
          } else {
            stdout += line + "\n";
          }
        }
        stdout = stdout.trimEnd();

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          session.process.stdout?.off("data", onStdout);
          session.process.stderr?.off("data", onStderr);
          resolve({
            stdout: truncateOutput(stdout).text,
            stderr: truncateOutput(stderr).text,
            exitCode,
          });
        }
      } else {
        stdout += str;
      }
    };

    const onStderr = (data: Buffer) => {
      stderr += data.toString();
    };

    session.process.stdout?.on("data", onStdout);
    session.process.stderr?.on("data", onStderr);

    // Send command with exit code marker
    session.process.stdin?.write(`${command}; echo "${marker}:$?"\n`);
    session.lastUsedAt = Date.now();
  });
}

// ── Tool Registration ───────────────────────────────────────────────────────

export function registerComputerTools(registry: {
  register(tool: any): void;
}): void {
  // ── shell_exec ──────────────────────────────────────────────────────────

  registry.register({
    name: "shell_exec",
    description:
      "Run a one-shot shell command on the host system. Returns stdout, stderr, and exit code. Use for quick commands like 'ls', 'df -h', 'git status'. For multi-step workflows, use shell sessions instead.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        workingDir: {
          type: "string",
          description:
            "Working directory (default: home dir). Supports ~ expansion.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 60, max: 300)",
        },
      },
      required: ["command"],
    },
    permissions: [],
    execute: async (params: any) => {
      const command = String(params.command || "");
      if (!command) throw new Error("Command is required");

      const blocked = isBlocked(command);
      if (blocked) throw new Error(blocked);

      const cwd = params.workingDir
        ? expandPath(String(params.workingDir))
        : homedir();
      const timeoutSec = Math.min(
        Math.max(Number(params.timeout) || 60, 1),
        300,
      );

      console.log(`💻 shell_exec: ${command.slice(0, 100)}`);

      return new Promise((resolve) => {
        const startTime = Date.now();
        exec(
          command,
          { cwd, timeout: timeoutSec * 1000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            const durationMs = Date.now() - startTime;
            const stdoutResult = truncateOutput(String(stdout || ""));
            const stderrResult = truncateOutput(String(stderr || ""));

            resolve({
              stdout: stdoutResult.text,
              stderr: stderrResult.text,
              exitCode: error?.code ?? (error ? 1 : 0),
              durationMs,
              truncated: stdoutResult.truncated || stderrResult.truncated,
            });
          },
        );
      });
    },
  });

  // ── shell_session_start ─────────────────────────────────────────────────

  registry.register({
    name: "shell_session_start",
    description:
      "Start a persistent shell session. The session retains state (cwd, env vars, aliases) across multiple shell_session_exec calls. Use for multi-step workflows like: cd into project → install deps → build → test. Max 5 concurrent sessions.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        workingDir: {
          type: "string",
          description: "Starting directory (default: home dir)",
        },
        shell: {
          type: "string",
          enum: ["bash", "zsh", "sh"],
          description: "Shell to use (default: zsh on macOS)",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      if (sessions.size >= MAX_SESSIONS) {
        throw new Error(
          `Max ${MAX_SESSIONS} concurrent sessions. Close one with shell_session_end first.`,
        );
      }

      const cwd = params.workingDir
        ? expandPath(String(params.workingDir))
        : homedir();
      const shell = String(
        params.shell || (platform() === "darwin" ? "zsh" : "bash"),
      );
      const sessionId = `session_${++sessionCounter}`;

      const proc = spawn(shell, ["-i"], {
        cwd,
        env: { ...process.env, TERM: "dumb" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const session: ShellSession = {
        id: sessionId,
        process: proc,
        cwd,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };

      sessions.set(sessionId, session);

      // Clean up on exit
      proc.on("exit", () => {
        sessions.delete(sessionId);
      });

      console.log(
        `💻 Shell session started: ${sessionId} (${shell} in ${cwd})`,
      );

      // Wait for shell prompt to be ready
      await new Promise((r) => setTimeout(r, 500));

      return {
        sessionId,
        shell,
        workingDir: cwd,
        activeSessions: sessions.size,
      };
    },
  });

  // ── shell_session_exec ──────────────────────────────────────────────────

  registry.register({
    name: "shell_session_exec",
    description:
      "Run a command in an existing persistent shell session. State (cwd, env vars, aliases) persists between calls. Use shell_session_start first to get a sessionId.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID from shell_session_start",
        },
        command: {
          type: "string",
          description: "Command to execute in the session",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 60, max: 300)",
        },
      },
      required: ["sessionId", "command"],
    },
    permissions: [],
    execute: async (params: any) => {
      const sessionId = String(params.sessionId || "");
      const command = String(params.command || "");
      if (!sessionId) throw new Error("sessionId is required");
      if (!command) throw new Error("command is required");

      const blocked = isBlocked(command);
      if (blocked) throw new Error(blocked);

      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(
          `Session "${sessionId}" not found. Available: ${[...sessions.keys()].join(", ") || "none"}`,
        );
      }

      const timeoutMs =
        Math.min(Math.max(Number(params.timeout) || 60, 1), 300) * 1000;

      console.log(`💻 [${sessionId}] ${command.slice(0, 100)}`);

      const result = await execInSession(session, command, timeoutMs);
      return result;
    },
  });

  // ── shell_session_end ───────────────────────────────────────────────────

  registry.register({
    name: "shell_session_end",
    description: "Close a persistent shell session and free resources.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to close",
        },
      },
      required: ["sessionId"],
    },
    permissions: [],
    execute: async (params: any) => {
      const sessionId = String(params.sessionId || "");
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session "${sessionId}" not found` };
      }

      session.process.kill();
      sessions.delete(sessionId);
      console.log(`💻 Shell session closed: ${sessionId}`);

      return { success: true, sessionId, remainingSessions: sessions.size };
    },
  });

  // ── file_read ───────────────────────────────────────────────────────────

  registry.register({
    name: "file_read",
    description:
      "Read contents of a file. Supports optional line range for large files.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path. Supports ~ expansion.",
        },
        startLine: {
          type: "number",
          description: "Start line (1-indexed, inclusive). Default: 1",
        },
        endLine: {
          type: "number",
          description:
            "End line (1-indexed, inclusive). Default: startLine + 200",
        },
      },
      required: ["path"],
    },
    permissions: [],
    execute: async (params: any) => {
      const filePath = expandPath(String(params.path || ""));
      if (!filePath) throw new Error("path is required");

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = readFileSync(filePath, "utf-8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;

      const startLine = Math.max(1, Number(params.startLine) || 1);
      const endLine = Math.min(
        totalLines,
        Number(params.endLine) || startLine + 199,
      );

      const selectedLines = allLines.slice(startLine - 1, endLine);
      const result = selectedLines.join("\n");
      const truncated = endLine < totalLines;

      return {
        content: truncateOutput(result).text,
        totalLines,
        startLine,
        endLine,
        truncated,
        path: filePath,
      };
    },
  });

  // ── file_write ──────────────────────────────────────────────────────────

  registry.register({
    name: "file_write",
    description:
      "Write, append, or insert content into a file. Creates parent directories if needed.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path. Supports ~ expansion.",
        },
        content: {
          type: "string",
          description: "Content to write",
        },
        mode: {
          type: "string",
          enum: ["write", "append"],
          description:
            "Write mode: 'write' (overwrite/create) or 'append'. Default: write.",
        },
      },
      required: ["path", "content"],
    },
    permissions: [],
    execute: async (params: any) => {
      const filePath = expandPath(String(params.path || ""));
      const content = String(params.content || "");
      const mode = String(params.mode || "write");

      if (!filePath) throw new Error("path is required");

      // Create parent directories
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (mode === "append") {
        appendFileSync(filePath, content, "utf-8");
      } else {
        writeFileSync(filePath, content, "utf-8");
      }

      const bytes = Buffer.byteLength(content, "utf-8");
      console.log(`📝 file_write: ${filePath} (${bytes} bytes, ${mode})`);

      return {
        success: true,
        path: filePath,
        bytes,
        mode,
      };
    },
  });

  // ── file_list ───────────────────────────────────────────────────────────

  registry.register({
    name: "file_list",
    description:
      "List contents of a directory. Returns file names, types, sizes, and modification times.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path. Supports ~ expansion. Default: home dir.",
        },
        pattern: {
          type: "string",
          description:
            "Glob-like filter (e.g. '*.ts', '*.json'). Simple suffix matching.",
        },
        showHidden: {
          type: "boolean",
          description:
            "Include hidden files (starting with .). Default: false.",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      const dirPath = expandPath(String(params.path || "~"));
      const pattern = params.pattern ? String(params.pattern) : null;
      const showHidden = Boolean(params.showHidden);

      if (!existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
      }

      let names = readdirSync(dirPath);

      // Filter hidden files
      if (!showHidden) {
        names = names.filter((n) => !n.startsWith("."));
      }

      // Simple pattern matching
      if (pattern) {
        const ext = pattern.startsWith("*.") ? pattern.slice(1) : null;
        if (ext) {
          names = names.filter((n) => n.endsWith(ext));
        } else {
          names = names.filter((n) => n.includes(pattern));
        }
      }

      // Cap at 100 entries
      const capped = names.length > 100;
      if (capped) names = names.slice(0, 100);

      const entries = names.map((name) => {
        try {
          const fullPath = join(dirPath, name);
          const stat = statSync(fullPath);
          return {
            name,
            type: stat.isDirectory() ? "directory" : "file",
            size: stat.isFile() ? stat.size : undefined,
            modified: stat.mtime.toISOString(),
          };
        } catch {
          return { name, type: "unknown" };
        }
      });

      return {
        path: dirPath,
        entries,
        count: entries.length,
        truncated: capped,
      };
    },
  });

  // ── process_list ────────────────────────────────────────────────────────

  registry.register({
    name: "process_list",
    description:
      "List running processes with PID, name, CPU, and memory usage. Optionally filter by name.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description:
            "Filter processes by name (case-insensitive substring match)",
        },
        limit: {
          type: "number",
          description: "Max processes to return (default: 30)",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      const filter = params.filter ? String(params.filter).toLowerCase() : null;
      const limit = Math.min(Number(params.limit) || 30, 100);

      return new Promise((resolve) => {
        const cmd = platform() === "darwin" ? "ps aux" : "ps aux --sort=-%mem";

        exec(cmd, { timeout: 10_000 }, (error, stdout) => {
          if (error) {
            resolve({ processes: [], error: error.message });
            return;
          }

          const lines = String(stdout).split("\n").slice(1); // skip header
          let processes = lines
            .filter((l) => l.trim())
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              return {
                pid: parseInt(parts[1], 10),
                cpu: parseFloat(parts[2]) || 0,
                mem: parseFloat(parts[3]) || 0,
                name: parts.slice(10).join(" "),
              };
            })
            .filter((p) => !isNaN(p.pid));

          if (filter) {
            processes = processes.filter((p) =>
              p.name.toLowerCase().includes(filter),
            );
          }

          // Sort by CPU desc
          processes.sort((a, b) => b.cpu - a.cpu);

          resolve({
            processes: processes.slice(0, limit),
            total: processes.length,
          });
        });
      });
    },
  });

  // ── process_kill ────────────────────────────────────────────────────────

  registry.register({
    name: "process_kill",
    description:
      "Kill a process by PID. Use process_list first to find the PID.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        pid: {
          type: "number",
          description: "Process ID to kill",
        },
        signal: {
          type: "string",
          enum: ["SIGTERM", "SIGKILL", "SIGINT"],
          description: "Signal to send (default: SIGTERM)",
        },
      },
      required: ["pid"],
    },
    permissions: [],
    execute: async (params: any) => {
      const pid = Number(params.pid);
      if (!Number.isFinite(pid) || pid <= 0) {
        throw new Error("Valid PID is required");
      }

      // Don't kill system-critical PIDs
      if (pid === 1 || pid === process.pid) {
        throw new Error("Cannot kill PID 1 or the Nova process itself");
      }

      const signal = String(params.signal || "SIGTERM") as NodeJS.Signals;

      try {
        process.kill(pid, signal);
        return { success: true, pid, signal };
      } catch (err: any) {
        return { success: false, pid, error: err.message };
      }
    },
  });

  // ── system_info ─────────────────────────────────────────────────────────

  registry.register({
    name: "system_info",
    description:
      "Get system information: OS, CPU, memory, disk usage, and network interfaces.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "string",
            enum: ["os", "cpu", "memory", "disk", "network"],
          },
          description: "Which sections to include. Default: all.",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      const sections: string[] = params.sections || [
        "os",
        "cpu",
        "memory",
        "disk",
        "network",
      ];
      const info: Record<string, unknown> = {};

      if (sections.includes("os")) {
        info.os = {
          platform: platform(),
          type: type(),
          arch: arch(),
          hostname: hostname(),
          uptime: `${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`,
        };
      }

      if (sections.includes("cpu")) {
        const cpuList = cpus();
        info.cpu = {
          model: cpuList[0]?.model || "unknown",
          cores: cpuList.length,
          speed: `${cpuList[0]?.speed || 0} MHz`,
        };
      }

      if (sections.includes("memory")) {
        const totalGB = (totalmem() / 1024 ** 3).toFixed(1);
        const freeGB = (freemem() / 1024 ** 3).toFixed(1);
        const usedGB = ((totalmem() - freemem()) / 1024 ** 3).toFixed(1);
        info.memory = {
          total: `${totalGB} GB`,
          used: `${usedGB} GB`,
          free: `${freeGB} GB`,
          usagePercent: `${(((totalmem() - freemem()) / totalmem()) * 100).toFixed(1)}%`,
        };
      }

      if (sections.includes("disk")) {
        // Use df for disk info
        info.disk = await new Promise((resolve) => {
          exec("df -h / | tail -1", { timeout: 5000 }, (err, stdout) => {
            if (err) {
              resolve({ error: err.message });
              return;
            }
            const parts = String(stdout).trim().split(/\s+/);
            resolve({
              filesystem: parts[0],
              total: parts[1],
              used: parts[2],
              available: parts[3],
              usagePercent: parts[4],
            });
          });
        });
      }

      if (sections.includes("network")) {
        const nets = networkInterfaces();
        const interfaces: Record<string, string[]> = {};
        for (const [name, addrs] of Object.entries(nets)) {
          if (!addrs) continue;
          interfaces[name] = addrs
            .filter((a) => !a.internal)
            .map((a) => `${a.family}: ${a.address}`);
        }
        // Only include non-empty
        info.network = Object.fromEntries(
          Object.entries(interfaces).filter(([, v]) => v.length > 0),
        );
      }

      return info;
    },
  });

  // ── OS dispatch helper ──────────────────────────────────────────────────

  const OS = platform(); // "darwin" | "linux" | "win32"

  // ── clipboard ───────────────────────────────────────────────────────────

  registry.register({
    name: "clipboard",
    description:
      "Read or write the system clipboard. Use 'read' to get current clipboard contents, 'write' to set them.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "write"],
          description: "Whether to read or write the clipboard",
        },
        content: {
          type: "string",
          description: "Content to write (required when action is 'write')",
        },
      },
      required: ["action"],
    },
    permissions: [],
    execute: async (params: any) => {
      const action = String(params.action || "read");

      if (action === "read") {
        const cmd =
          OS === "darwin"
            ? "pbpaste"
            : OS === "win32"
              ? "powershell -command Get-Clipboard"
              : "xclip -selection clipboard -o";

        return new Promise((resolve) => {
          exec(cmd, { timeout: 5000 }, (err, stdout) => {
            if (err) {
              resolve({ success: false, error: err.message });
              return;
            }
            resolve({ success: true, content: String(stdout) });
          });
        });
      } else if (action === "write") {
        const content = String(params.content || "");
        if (!content) throw new Error("content is required for write action");

        const cmd =
          OS === "darwin"
            ? "pbcopy"
            : OS === "win32"
              ? "powershell -command Set-Clipboard"
              : "xclip -selection clipboard";

        return new Promise((resolve) => {
          const child = exec(cmd, { timeout: 5000 }, (err) => {
            if (err) {
              resolve({ success: false, error: err.message });
              return;
            }
            resolve({ success: true, bytes: Buffer.byteLength(content) });
          });
          child.stdin?.write(content);
          child.stdin?.end();
        });
      }

      throw new Error("action must be 'read' or 'write'");
    },
  });

  // ── notify ──────────────────────────────────────────────────────────────

  registry.register({
    name: "notify",
    description:
      "Send a native operating system notification to the user's desktop.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Notification title (default: 'Nova')",
        },
        message: {
          type: "string",
          description: "Notification message body",
        },
      },
      required: ["message"],
    },
    permissions: [],
    execute: async (params: any) => {
      const title = String(params.title || "Nova");
      const message = String(params.message || "");
      if (!message) throw new Error("message is required");

      // Escape quotes for shell
      const safeTitle = title.replace(/"/g, '\\"');
      const safeMsg = message.replace(/"/g, '\\"');

      let cmd: string;
      if (OS === "darwin") {
        cmd = `osascript -e 'display notification "${safeMsg}" with title "${safeTitle}"'`;
      } else if (OS === "win32") {
        cmd = `powershell -command "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${safeTitle}', '${safeMsg}', 'Info')"`;
      } else {
        cmd = `notify-send "${safeTitle}" "${safeMsg}"`;
      }

      return new Promise((resolve) => {
        exec(cmd, { timeout: 10_000 }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          resolve({ success: true, title, message });
        });
      });
    },
  });

  // ── open_app ────────────────────────────────────────────────────────────

  registry.register({
    name: "open_app",
    description:
      "Open a file, URL, or application using the OS default handler. Works cross-platform.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "What to open: a URL ('https://...'), file path, or app name (macOS: 'Safari', 'Finder')",
        },
      },
      required: ["target"],
    },
    permissions: [],
    execute: async (params: any) => {
      const target = String(params.target || "");
      if (!target) throw new Error("target is required");

      const expanded = target.startsWith("~") ? expandPath(target) : target;

      let cmd: string;
      if (OS === "darwin") {
        // Check if it looks like an app name (no path separators, no extension, no URL)
        const isAppName =
          !expanded.includes("/") &&
          !expanded.includes(".") &&
          !expanded.startsWith("http");
        cmd = isAppName ? `open -a "${expanded}"` : `open "${expanded}"`;
      } else if (OS === "win32") {
        cmd = `start "" "${expanded}"`;
      } else {
        cmd = `xdg-open "${expanded}"`;
      }

      return new Promise((resolve) => {
        exec(cmd, { timeout: 10_000 }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          resolve({ success: true, opened: expanded });
        });
      });
    },
  });

  // ── screenshot ──────────────────────────────────────────────────────────

  registry.register({
    name: "screenshot",
    description:
      "Capture a screenshot of the desktop. Set send: true to deliver the screenshot to the user via the current channel.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Optional filename (default: screenshot_<timestamp>.png)",
        },
        send: {
          type: "boolean",
          description:
            "If true, send the screenshot to the user via the current channel. Default: false.",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      const screenshotDir = join(
        homedir(),
        ".nova",
        "workspace",
        "screenshots",
      );
      if (!existsSync(screenshotDir)) {
        mkdirSync(screenshotDir, { recursive: true });
      }

      const filename = String(
        params.filename || `screenshot_${Date.now()}.png`,
      );
      const filePath = join(screenshotDir, filename);
      const shouldSend = Boolean(params.send);

      let cmd: string;
      if (OS === "darwin") {
        cmd = `screencapture -x "${filePath}"`;
      } else if (OS === "win32") {
        // PowerShell screenshot
        cmd = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bitmap.Save('${filePath}'); $graphics.Dispose(); $bitmap.Dispose()"`;
      } else {
        // Try scrot first (common on Linux), fallback to gnome-screenshot
        cmd = `scrot "${filePath}" 2>/dev/null || gnome-screenshot -f "${filePath}" 2>/dev/null || import -window root "${filePath}"`;
      }

      return new Promise((resolve) => {
        exec(cmd, { timeout: 10_000 }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          let size = 0;
          try {
            size = statSync(filePath).size;
          } catch {
            /* ignore */
          }

          console.log(`📸 Screenshot saved: ${filePath} (${size} bytes)`);

          let delivered = false;
          if (shouldSend) {
            try {
              const imageBuffer = readFileSync(filePath);
              const imageBase64 = imageBuffer.toString("base64");
              pushPendingImage({
                imageBase64,
                caption: "📸 Desktop screenshot",
              });
              delivered = true;
              console.log(`📸 Screenshot queued for delivery`);
            } catch (readErr: any) {
              console.warn(
                `📸 Screenshot saved but could not queue for delivery: ${readErr.message}`,
              );
            }
          }

          resolve({ success: true, path: filePath, size, delivered });
        });
      });
    },
  });

  // ── port_info ───────────────────────────────────────────────────────────

  registry.register({
    name: "port_info",
    description:
      "Check what process is using a specific port. Useful for debugging 'port already in use' errors.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port number to check",
        },
      },
      required: ["port"],
    },
    permissions: [],
    execute: async (params: any) => {
      const port = Number(params.port);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error("Valid port number (1-65535) is required");
      }

      let cmd: string;
      if (OS === "win32") {
        cmd = `netstat -ano | findstr :${port}`;
      } else {
        cmd = `lsof -i :${port} -P -n`;
      }

      return new Promise((resolve) => {
        exec(cmd, { timeout: 10_000 }, (err, stdout) => {
          const output = String(stdout || "").trim();
          if (err || !output) {
            resolve({ port, occupied: false, processes: [] });
            return;
          }

          const lines = output.split("\n").slice(1); // skip header
          const processes = lines
            .filter((l) => l.trim())
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              if (OS === "win32") {
                return {
                  pid: parseInt(parts[parts.length - 1], 10),
                  raw: line.trim(),
                };
              }
              return {
                command: parts[0],
                pid: parseInt(parts[1], 10),
                user: parts[2],
                type: parts[4],
                node: parts[7],
                name: parts[8],
              };
            })
            .filter((p) => !isNaN(p.pid));

          resolve({ port, occupied: true, processes });
        });
      });
    },
  });
}
