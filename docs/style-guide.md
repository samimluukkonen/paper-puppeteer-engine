# UI style guide — GitHub / Primer

The application follows **GitHub's Primer product UI**: compact controls, clear hierarchy, quiet bordered surfaces and consistent interactions. This document is the repository's implementation guide. The Animation Editor is the existing visual reference; Project Workspace, Rig Editor, Scene Editor and the demo use the same foundation.

Official references: [Primer Product UI](https://primer.style/product/), [foundations](https://primer.style/product/getting-started/foundations/), [layout](https://primer.style/product/getting-started/foundations/layout/), [primitives](https://primer.style/product/primitives/). The rules below adapt those conventions to this desktop authoring tool; they do not claim pixel-identical GitHub components. We reuse the existing React/CSS implementation and Lucide icons; adding Primer packages or replacing the icon library is unnecessary.

## Shared implementation

| Concern                                                             | Source of truth                       |
| ------------------------------------------------------------------- | ------------------------------------- |
| Colors, fonts, basic controls and focus rings                       | `src/ui/theme.css`                    |
| One application header, identity, navigation and Feature Guide slot | `src/ui/viewShell.tsx` (`ViewHeader`) |
| Header typography and navigation                                    | `src/ui/viewShell.css`                |
| Compact desktop chrome, command bars, panels and inspector layout   | `src/ui/workspace.css`                |
| View-specific content layout only                                   | The view's own stylesheet             |

All pages must use `ViewHeader`. Do not copy its markup into a page or restyle the Project header independently. A page may supply its title/context, Feature Guide content and controls below the header through the shared component. Keep the shared logo, version badge, navigation icons, active-page indicator and focus treatment.

Use `FeatureGuideButton` and `FeatureGuideCatalog` for every Feature Guide entry point. Keep the same category tabs, guide cards, descriptions and launch controls. Project asset selection belongs inside the shared catalog; the target editor checks live requirements before starting the selected tour. Do not add a separate page-specific guide picker.

## Page hierarchy and density

- Start with the shared header. Put document commands and local-save/recovery controls **below** it, followed by content. Recovery must never add a banner above the header.
- Use the compact Animation Editor proportions: 16 px page gutters, 8 px gaps between chrome regions, 12–16 px panel padding, 6 px control radii and subtle 1 px borders. Use 4, 8, 12, 16 and 24 px spacing increments for new content; reuse existing component rules first.
- Expanded settings use 16 px between the disclosure summary and form, 8 px between labels and inputs, and 8 px between adjacent controls. Align action buttons with the input edge.
- Asset libraries use collapsed, counted categories and separate readable rows. Constrain image previews to fixed boxes with `object-fit: contain`; release preview object URLs when the category closes. Do not render inventories as comma-separated paragraphs.
- Keep related actions together in a command bar and use bordered lists/panels for assets. Avoid extra nested boxes, large empty banners, oversized titles and decorative cards.
- Keep inspector disclosures and project details collapsed initially. Opening a section is view state, independent of authored Undo/Redo and export data.
- Target desktop windows only. Do not add mobile layouts or mobile verification without an explicit change to repository policy.

## Color and typography

Use semantic CSS variables, not page-specific palette copies. Current dark-theme examples:

| Purpose               | Token                        | Value                |
| --------------------- | ---------------------------- | -------------------- |
| Page / panel          | `--bg-default`, `--bg-panel` | `#0d1117`            |
| Header / input        | `--bg-inset`                 | `#010409`            |
| Command surface       | `--bg-subtle`                | `#161b22`            |
| Hover                 | `--bg-hover`                 | `#212830`            |
| Main / secondary text | `--fg-default`, `--fg-muted` | `#e6edf3`, `#9198a1` |
| Borders               | `--border-default`           | `#3d444d`            |
| Links / focus         | `--accent-fg`                | `#58a6ff`            |
| Primary action        | `--success-emphasis`         | `#238636`            |
| Destructive text      | `--danger-fg`                | `#f85149`            |

Use the shared system sans-serif stack; reserve `--font-mono` for JSON, IDs or numeric/code content where it aids reading. Keep normal letter spacing and sentence case. Existing compact chrome uses 11–13 px labels and 28 px minimum control height; use the shared heading rules rather than inventing a new scale. State and meaning must also be conveyed with words/icons, not color alone.

## Controls and feedback

- Use neutral buttons for ordinary commands, green `.workspace-primary` for create/add actions (including New Character, New Scene and Add Existing Character) and the main export action, and `.workspace-danger` for destructive cleanup/removal. Keep the same hover, disabled and focus behavior everywhere.
- Navigation is a link; an operation is a button. Every enabled button must perform an available operation or show actionable feedback.
- Hide **Recovery drafts** when there are no retained drafts. Hide its empty bar when no document or feedback is present. Refresh availability after successful saves/discards and when returning to the window. Keep save status visible for an open document.
- Keep local save status in one quiet, vertically centered row. Put Recovery drafts and Draft actions at the right; keep retry/resume and discard inside the actions menu. Show detailed failures with an actionable next step without repeating the full recovery error across the page.
- Recovery discovery must not interrupt editing when a new autosave appears. Offer existing recovery on startup; reopening the catalog is explicit.
- Keep file import compact: a named button opens an accessibly labelled file input; do not show a redundant native “Choose file / No file chosen” row next to the same action.
- Clearly distinguish local saves, document checkpoints and portable ZIP downloads. Use concise inline success/error text with a next action. Do not add modal confirmations to harmless navigation.
- Preserve semantic labels, keyboard operation, visible focus, disabled states and live feedback. Icons use the existing 16 px Lucide treatment and retain an accessible text label or name.

## Reviewing UI changes

Compare Project, Rig, Animation, Scene and demo headers on desktop: the shared logo/version/navigation and active state must match. Check empty/loading/populated/error states, keyboard focus, collapsed inspectors and genuine action availability. Use local browser tests and screenshots for relevant behavior; keep browser tests/installations out of CI. New page CSS should describe content geometry, not duplicate shared controls or header styling.
