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
  /* T28 (DESIGN.md §8/§5.5): the centered screen keeps its centered flex
     column, gains the responsive gutters (--gutter, mobile pair in the
     media block), and the honest-viewport height — the two-line dvh
     cascade (DECISIONS.md §11 evergreen-only; the URL bar must not lie
     about the viewport on phones). */
  main {
    /* pre-dvh fallback, then the evergreen dynamic viewport */
    min-height: 100vh;
    min-height: 100dvh; /* evergreen dynamic viewport (DECISIONS.md §11) */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    text-align: center;
    padding-inline: var(--gutter);
  }

  h1 {
    margin: 0;
  }

  .line {
    margin: 0;
    color: var(--ink-muted);
  }

  /* The create form spans the gutters and caps at 24rem (T28 §9: the form
     fills the mobile layout without ever overflowing it); the input takes
     the remaining space beside the button (flex:1 + min-width:0 — a
     80-char unbroken stack name must shrink the input, never stretch the
     row; STACK_NAME_MAX_LENGTH guard). */
  form {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    max-width: 24rem;
  }

  form input {
    flex: 1;
    min-width: 0;
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
    /* Keep the failure line above WCAG AA's quiet-ink floor: --ink-muted
       (#5a413b) is darker than the old #555, so the rationale holds a
       fortiori (§6 register; the palette itself is tokens.css, T24). */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  @media (max-width: 640px) {
    /* The mobile gutter pair, per tokens.css' breakpoint documentation. */
    main {
      padding-inline: var(--gutter-mobile);
    }
  }
</style>
