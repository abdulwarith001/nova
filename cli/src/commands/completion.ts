import chalk from "chalk";

const COMMANDS = [
  "init",
  "chat",
  "daemon",
  "run",
  "telegram",
  "brave",
  "google",
  "web",
  "memory",
  "config",
  "reasoning",
  "reset",
  "skill",
  "tasks",
  "completion",
];

const DAEMON_ACTIONS = ["start", "stop", "status", "logs", "restart"];
const MEMORY_ACTIONS = ["status", "user", "agent", "rules", "list", "export"];
const CONFIG_ACTIONS = ["show", "get", "set", "edit"];
const TELEGRAM_ACTIONS = ["setup", "status", "disable", "test"];

/**
 * nova completion [shell]
 *
 * Output shell completion scripts for zsh or bash.
 * Usage:
 *   eval "$(nova completion zsh)"   # add to ~/.zshrc
 *   eval "$(nova completion bash)"  # add to ~/.bashrc
 */
export async function completionCommand(shell?: string): Promise<void> {
  const target = shell?.toLowerCase() || "zsh";

  switch (target) {
    case "zsh":
      console.log(generateZshCompletion());
      break;
    case "bash":
      console.log(generateBashCompletion());
      break;
    case "help":
      showHelp();
      break;
    default:
      console.error(chalk.red(`Unknown shell: ${target}`));
      showHelp();
      process.exitCode = 1;
  }
}

function showHelp(): void {
  console.log(chalk.cyan("Nova CLI Completion\n"));
  console.log("Usage: nova completion <shell>\n");
  console.log("Shells:");
  console.log('  zsh     — eval "$(nova completion zsh)"');
  console.log('  bash    — eval "$(nova completion bash)"');
  console.log("\nAdd the eval line to your shell rc file for persistence.");
}

function generateZshCompletion(): string {
  return `
# Nova CLI zsh completion
# Add to ~/.zshrc: eval "$(nova completion zsh)"

_nova() {
  local -a commands
  commands=(
    ${COMMANDS.map((c) => `'${c}:${getCommandDesc(c)}'`).join("\n    ")}
  )

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'nova command' commands
      ;;
    args)
      case $words[1] in
        daemon)
          _values 'action' ${DAEMON_ACTIONS.join(" ")}
          ;;
        memory)
          _values 'action' ${MEMORY_ACTIONS.join(" ")}
          ;;
        config)
          _values 'action' ${CONFIG_ACTIONS.join(" ")}
          ;;
        telegram)
          _values 'action' ${TELEGRAM_ACTIONS.join(" ")}
          ;;
      esac
      ;;
  esac
}

compdef _nova nova
`;
}

function generateBashCompletion(): string {
  return `
# Nova CLI bash completion
# Add to ~/.bashrc: eval "$(nova completion bash)"

_nova_complete() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${COMMANDS.join(" ")}"

  case "\${prev}" in
    nova)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      ;;
    daemon)
      COMPREPLY=( $(compgen -W "${DAEMON_ACTIONS.join(" ")}" -- "\${cur}") )
      ;;
    memory)
      COMPREPLY=( $(compgen -W "${MEMORY_ACTIONS.join(" ")}" -- "\${cur}") )
      ;;
    config)
      COMPREPLY=( $(compgen -W "${CONFIG_ACTIONS.join(" ")}" -- "\${cur}") )
      ;;
    telegram)
      COMPREPLY=( $(compgen -W "${TELEGRAM_ACTIONS.join(" ")}" -- "\${cur}") )
      ;;
  esac
}

complete -F _nova_complete nova
`;
}

function getCommandDesc(cmd: string): string {
  const descs: Record<string, string> = {
    init: "Initialize Nova configuration",
    chat: "Start interactive chat",
    daemon: "Manage daemon (start|stop|status|logs|restart)",
    run: "Execute a one-time task",
    telegram: "Manage Telegram channel",
    brave: "Manage Brave Search API",
    google: "Manage Google Workspace",
    web: "Web-agent utilities",
    memory: "Manage memory",
    config: "Manage configuration",
    reasoning: "View reasoning logs",
    reset: "Reset agent data",
    skill: "Manage skills",
    tasks: "View and manage tasks",
    completion: "Output shell completions",
  };
  return descs[cmd] || cmd;
}
