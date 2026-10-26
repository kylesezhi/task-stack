<script lang="ts">
  /**
   * FirstRunView (T17; sources: TASKS.md T17, DESIGN.md §5.5, §6) — the very
   * first screen ever, entered/exited only by server truth (no stacks ⇔ this
   * view). No chrome at all: quiet heading, one input, one "Create stack"
   * button, one line of explanation.
   *
   * Submit goes through the store's createStack (T15), which resolves
   * `{ok:true} | {ok:false; error}` — callers never catch. On success there
   * is deliberately NO navigation code: createStack applies the response
   * snapshot, and the view machine (T16) sees a stack appear and flips
   * firstRun → stack in the same round-trip. On failure the server's error
   * string is shown as one quiet muted line (§6 register), and the typed
   * name stays in the input so the retry is one keystroke away.
   */
  import { STACK_NAME_MAX_LENGTH } from "@task-stack/shared";
  import { createStack } from "../lib/store";

  let name = $state("");
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Same trim the server applies (shared/src/validation.ts) — the button's
  // enabled state mirrors the server's min-1 rule, so a broken submit can
  // only come from a length/type violation, never from whitespace.
  const trimmed = $derived(name.trim());
  const canSubmit = $derived(trimmed.length > 0 && !submitting);

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return; // native Enter submits even when disabled
    submitting = true;
    error = null;
    const result = await createStack(trimmed);
    if (result.ok) {
      // Nothing else to do here: the view machine flips to StackView from
      // server truth in the same round-trip (createStack applied the fresh
      // snapshot before this promise resolved). This component unmounts.
    } else {
      // `name` is untouched — the user keeps what they typed for the retry.
      error = result.error;
      submitting = false;
    }
  }
</script>

<main class="first-run">
  <h1>What's this stack for?</h1>
  <p class="line">One note at a time. The top of the stack is the only thing to do.</p>
  <!-- Visually-hidden label (not aria-label): the name is real content and
       the drawer's later create input will share the same phrase (§5.4). -->
  <form onsubmit={onSubmit}>
    <label class="visually-hidden" for="stack-name">Stack name</label>
    <input
      id="stack-name"
      type="text"
      bind:value={name}
      maxlength={STACK_NAME_MAX_LENGTH}
      placeholder="Name this stack"
      autocomplete="off"
    />
    <button type="submit" disabled={!canSubmit}>Create stack</button>
  </form>
  {#if error !== null}
    <p class="error" role="alert">{error}</p>
  {/if}
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

  form {
    display: flex;
    gap: 0.5rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .error {
    margin: 0;
    /* #555 (not #999): this is the ONLY failure feedback, and #999 on white
       is ~2.85:1 — below WCAG AA. Same quiet ink as .line (§6 register;
       real color design stays Phase 3). */
    color: #555;
    font-size: 0.9rem;
  }
</style>
