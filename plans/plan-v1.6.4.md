# Paper Puppeteer Engine — v1.6.4
## Linear Story Player & Keyboard Input

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented:
- StoryDefinition
- Story sequencing
- Dialogue advance holds
- Hold-safe animations and audio
- Visual Story Editor
- Existing scene runtime, audio and subtitles

## Goal

Create a lightweight standalone Story Player capable of playing a complete linear story.

The viewer should only need to advance dialogue.

Mukashi Monogatari does NOT contain gameplay, player choices or branching narrative interactions.

## 1. Inspect runtime architecture

Review:
- Standalone Scene Player
- Project asset loader
- Story sequence controller
- Dialogue hold API
- Subtitle presentation
- Keyboard input handling
- Phaser game lifecycle
- Runtime cleanup

Do not embed React editor components into the standalone player.

## 2. Story Player API

Provide a small runtime-facing controller.

Conceptually:

```ts
interface StoryPlayer {
  load(storyId: string): Promise<void>;
  play(): void;
  stop(): void;
  advanceDialogue(): void;
  dispose(): void;
}
```

Adapt to existing runtime APIs.

Do not introduce duplicate clocks or character renderers.

## 3. Keyboard input

Default viewer interaction:

**Enter → Advance current dialogue**

Optionally support a configured equivalent such as Space.

Keyboard handling must:
- Work only when a dialogue hold is waiting.
- Ignore key-repeat events.
- Consume one dialogue step per deliberate press.
- Avoid duplicate listeners.
- Respect runtime focus.
- Not intercept typing in text inputs when the editor embeds the player.
- Be disposed properly.

Do not make Enter a general scene-skipping command.

## 4. Input abstraction

Keep the runtime action independent from the physical keyboard.

For example:

```ts
advanceDialogue()
```

The configured input calls that method.

This allows the Mukashi Monogatari application to supply an equivalent input if needed without adding new gameplay actions.

Only dialogue advancement is required.

## 5. Dialogue presentation

Reuse the v1.3 dialogue presentation system.

For advance-required lines:
- Display speaker and text.
- Keep text visible while waiting.
- Provide a subtle advance indicator when appropriate.
- Advance only on configured input.

Preserve:
- Unicode
- Japanese text
- Multiline dialogue
- Existing font/layout conventions
- Camera-relative subtitle positioning

Do not automatically implement text reveal/typewriter effects unless already present.

## 6. No arbitrary input actions

The viewer must not receive controls for:
- Moving characters
- Attacking
- Changing camera
- Choosing story routes
- Opening inventory
- Triggering scene cues manually

The cinematic sequence remains author-controlled.

## 7. Playback lifecycle

Support:
- Load Story
- Play
- Wait for dialogue
- Advance dialogue
- Continue
- Automatically enter next scene
- Complete story
- Stop/dispose

A configured dialogue advance should not accidentally skip a scene transition or several consecutive dialogue lines.

## 8. Visual output

The player should display:
- Backgrounds
- Actors
- Skeletal/mesh animation
- Root motion
- Camera and fades
- Audio
- Dialogue

Use existing scene rendering infrastructure.

## 9. Browser restrictions

If audio playback requires user activation, use the normal audio-unlock behavior.

Do not assume autoplay will always be permitted.

If the viewer's initial Enter press is used to unlock audio/start playback, do not also consume a dialogue line unintentionally.

Document the chosen behavior.

## 10. Input accessibility

Maintain an obvious indication when dialogue advancement is available.

Allow an application host to configure an equivalent advance input.

Do not create unnecessary menus or complex control schemes.

## 11. Tests

Cover:
- Enter advances dialogue
- Key repeat ignored
- No hold means no action
- Consecutive dialogue
- Scene transition
- Restart
- Stop/dispose
- Focus handling
- Repeated mount/unmount
- Audio unlock
- Full story completion

## 12. Out of scope

Do not implement:
- Interactive dialogue choices
- Gameplay movement
- Branching narrative
- Save-game progression
- Player statistics
- Networked multiplayer
- New cinematic authoring tools

## 13. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Run available browser runtime tests.

Fix failures.

## Definition of done

A standalone viewer can play a scripted story and advance dialogue using Enter or an equivalent configured action without any other gameplay interaction.

## Final report

Describe player API, keyboard behavior, dialogue advancement, lifecycle, runtime integration, files changed, tests and exact verification results.
