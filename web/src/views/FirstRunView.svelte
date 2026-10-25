<script lang="ts">
  /**
   * FirstRunView placeholder (T16; DESIGN.md §5.5) — the very first screen
   * ever, entered/exited only by server truth (no stacks ⇔ this view). No
   * chrome at all by design, so there are no buttons to wire; the create
   * form arrives with T17 and must NOT be stubbed with a live POST here
   * (T16 is nav wiring only).
   */
</script>

<main class="first-run">
  <h1>What's this stack for?</h1>
  <p class="line">One note at a time. The top of the stack is the only thing to do.</p>
  <p class="placeholder">The create form arrives with T17.</p>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    text-align: center;
  }

  h1 {
    margin: 0;
  }

  .line {
    margin: 0;
    color: #555;
  }

  .placeholder {
    margin: 0;
    color: #999;
    font-size: 0.9rem;
  }
</style>
