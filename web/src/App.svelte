<script lang="ts">
  /** Shape of GET /api/health (server/src/app.ts, T03). */
  interface Health {
    ok: boolean;
  }

  /** null until the fetch settles; replaced once real views exist (T17). */
  let health: Health | null = $state(null);
  let failure: string | null = $state(null);

  async function checkHealth(): Promise<void> {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      health = (await response.json()) as Health;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
  }

  checkHealth();
</script>

<main>
  <h1>task-stack</h1>
  <p class="status">
    {#if failure}
      Can't reach the server: {failure}
    {:else if health === null}
      Checking the desk…
    {:else if health.ok}
      Server: healthy
    {:else}
      Server: not ok
    {/if}
  </p>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-family: system-ui, sans-serif;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .status {
    margin: 0;
    color: #555;
  }
</style>
