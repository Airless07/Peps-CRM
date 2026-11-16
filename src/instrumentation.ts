// Runs once when the server starts. Starts the background jobs (Node runtime only).
// The import must sit inside this exact condition so the Edge build drops it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobs } = await import("./lib/jobs");
    startJobs();
  }
}
