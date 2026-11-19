// Runs once when the server starts. Runs the one-time data fixes, then starts the background jobs (Node runtime only).
// The import must sit inside this exact condition so the Edge build drops it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // One-time data fixes first (they only fill in values that are still empty), then the jobs.
    const { runDataMigrations } = await import("./lib/data-migrations");
    await runDataMigrations();
    const { startJobs } = await import("./lib/jobs");
    startJobs();
  }
}
