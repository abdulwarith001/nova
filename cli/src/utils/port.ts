import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Kill any processes using the specified port
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length > 0) {
      console.log(`Killing ${pids.length} process(es) on port ${port}...`);

      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), "SIGTERM");
        } catch {
          // Process might already be dead
        }
      }

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force kill if still running
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), 0); // Check if still alive
          process.kill(parseInt(pid), "SIGKILL"); // Force kill
        } catch {
          // Already dead
        }
      }
    }
  } catch {
    // No process found or lsof failed, that's fine
  }
}

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
