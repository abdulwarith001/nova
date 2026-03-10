# Nova User Guide: Getting the Best Out of Your Agent

Welcome to Nova! Nova is a next-generation AI super agent designed to act autonomously on your behalf. Whether you need an assistant to draft code, perform deep internet research, manage your tasks, or interact with your Google Workspace, Nova leverages specialized "skills" to get the job done.

This guide focuses on how to set up Nova, understand its command-line interface (CLI), configure its skills, and best practices for interacting with it.

---

## 1. Setup & Initialization

Before Nova can work for you, it needs access to an AI model and some basic configuration.

### Step 1: Initializing Nova

The first time you use Nova, run the initialization command. This interactive wizard will walk you through the essential setup.

```bash
nova init
```

During this process, Nova will ask you:

1. **Which AI Engine to Use:** Choose an engine like Anthropic (Claude 3.5 Sonnet is highly recommended) or OpenAI.
2. **API Keys:** You will be prompted to paste your API Key.
   - To get an Anthropic key, visit: `https://console.anthropic.com/settings/keys`
   - To get an OpenAI key, visit: `https://platform.openai.com/api-keys`

_(If you press Enter to skip, you can always set this manually later)._

### Step 2: Manually Setting Environment Variables

Nova stores your configuration securely. If you need to update an API key or add a new one later, you have two options:

**Option A: Using the CLI (Recommended)**

```bash
nova config set ANTHROPIC_API_KEY your_new_key_here
```

**Option B: Using a `.env` file**
You can create a `.env` file in the directory where you run Nova and place your keys there:

```env
ANTHROPIC_API_KEY=sk-ant-api03-xxxx
OPENAI_API_KEY=sk-xxxx
```

### Step 3: Starting the Daemon

Nova relies on a background service called the "Daemon" to handle long-running tasks, reminders, and scheduled jobs. **For the best experience, you must keep the daemon running.**

1. Open a new terminal window.
2. Run the start command:
   ```bash
   nova daemon start
   ```
3. You can safely close this terminal window; the daemon will keep running in the background.

_You can stop it anytime with `nova daemon stop`, check its status with `nova daemon status`, or view its background activity with `nova daemon logs --tail`._

---

## 1.5 Customizing Memory & Personality

Nova has a built-in memory system. It remembers facts about you and how you want it to behave.

### Setting Your Agent's Personality

You can tell your agent how to speak, its tone, and its overarching goals.

```bash
nova memory agent
```

_Example:_ You can tell it: "You are Druski, a witty, sharp, and confident AI coach. Your responses should be concise but impactful, never boring or timid."

### Setting User Context (Who you are)

You can tell the agent facts about yourself so it doesn't have to ask you every time.

```bash
nova memory user
```

_Example:_ "My name is Abdulwarith. I am a software engineer building iOS apps using Swift. Always format code using 4 spaces."

---

## 2. Core Command Reference

Nova is controlled entirely through your terminal. Here are the primary commands you'll use day-to-day:

### Interacting with Nova

- `nova chat`: Start an interactive chat session with Nova.
  - Use `nova chat --agent <role>` to chat with a specific persona (e.g., `coder`, `researcher`, `analyst`).
- `nova run <task>`: Give Nova a single, one-off task to execute autonomously and return the result.
- `nova web`: Access web-agent utilities, such as bootstrapping a browser profile.

### Managing State

- `nova reasoning --tail`: **Highly Recommended.** Open a second terminal window and run this command. It streams Nova's internal "thought process" in real time, so you can see exactly what tools the agent is using and how it's planning to solve your problem.
- `nova memory`: Manage what Nova remembers. You can check its memory status, list memories, search, or tell it to `forget` certain things.
- `nova tasks`: View and manage your scheduled tasks, reminders, and background jobs.

### Specific Integrations

- `nova telegram setup`: Set up a Telegram bot so you can interact with Nova from your phone.
- `nova brave setup`: Configure the Brave Search API for web browsing and research.
- `nova google setup`: Configure Google Workspace access (Gmail, Docs, etc.).

---

## 3. The Skills Ecosystem & Deep Integrations

Nova's true power comes from its **Skills**. Skills are modular sets of tools that give Nova the ability to interact with the outside world. To see what your agent is currently capable of, run:

```bash
nova skill list
```

This lists all available skills and shows whether you have the required API keys (marked with a ✓ or ✗).

Here is how to set up the most powerful integrations in Nova:

### 3.1 Web Research (Brave Search)

To enable the `research-agent` and `web-browsing` skills so Nova can search the internet for you:

1. **Get an API Key:**
   - Go to `https://brave.com/search/api/` and create an account.
   - Generate a free API key.
2. **Configure Nova:**
   Run the setup command and paste your key when prompted.
   ```bash
   nova brave setup
   ```
3. **Verify:** Run `nova brave status` to ensure it is connected.

### 3.2 Telegram Bot Integration

You can control Nova directly from Telegram on your phone.

1. **Create a Bot:**
   - Open Telegram and search for `@BotFather`.
   - Send `/newbot` and follow the instructions to name your bot.
   - BotFather will give you an **HTTP API Token** (e.g., `123456789:ABCdefGHI...`).
2. **Configure Nova:**
   Run the setup command and paste your token when prompted.
   ```bash
   nova telegram setup
   ```
3. **Connect:** The setup wizard will give you a link to your new bot. Click it, press "Start" in Telegram, and Nova will bind itself to your Telegram account securely.

### 3.3 Google Workspace (Gmail, Docs, Calendar)

Nova's `google-workspace` skill allows it to read emails, draft responses, and manage your calendar.

1. **Start Setup:**
   Run the following command in your terminal:
   ```bash
   nova google setup
   ```
2. **Authenticate:**
   This will open a browser window asking you to sign securely into your Google Account.
   _(Note: Nova only requests the specific permissions it needs to operate)._
3. **Confirm:** Once you authorize access in the browser, return to your terminal. Nova is now connected to your Google Workspace. You can revoke this at any time using `nova google disable`.

### 3.4 The Computer Skill

By default, Nova is equipped with the `computer` skill. This allows it to read files, run terminal commands, and write code on your machine.

**⚠️ Important Disclaimer:**
Because this skill allows Nova to run bash scripts and create files, you should always monitor what it is doing. We highly recommend keeping a terminal window open running `nova reasoning --tail` so you can supervise exactly what commands Nova is executing on your computer.

---

## 4. Best Practices: Getting the Most Out of Nova

1. **Watch the Reasoning Logs**: Nova works in a loop (Observe, Orient, Decide, Act). Sometimes complex tasks take a few minutes. By opening a split terminal and running `nova reasoning --tail`, you can watch Nova make decisions. If it gets stuck, the reasoning logs will usually tell you why.
2. **Be Specific in Prompts**: The more context you provide, the better. Instead of "Fix my code", try "Review the `auth.js` file and find why the JWT token is expiring early."
3. **Use Roles**: If you want a deep dive on a topic, use `nova chat --agent researcher`. If you're building software, use `--agent coder`. This primes Nova with the right system prompt.
4. **Leverage the Daemon**: Ask Nova in chat to "Remind me to check on the deployment status in 30 minutes". As long as `nova daemon start` is running, Nova will handle it.
5. **Start Small with Computer Access**: If you ask Nova to run terminal commands, observe what it does in the reasoning logs. It is designed to be safe, but it is acting on your local machine.
