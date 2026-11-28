# Settings UI

Follow Rei's settings structure: a narrow category sidebar, one page title, and bordered cards with divided rows. Keep Moewatch's colors, focus rings, and 44px interaction targets. On phones, categories form a horizontal navigation row.

Only expose settings that provide value. Current categories:

- Account: compact AniList profile, sign-in, sign-out, and manual sync.
- Appearance: home editor, title language, release years, and home layout reset.
- Integrations, desktop only: Discord activity and watchparty toggles.
- Playback: audio, autoplay, resume, automatic skips, and provider priority.
- Subtitles: enabled state, size, background opacity, and live preview. Delay belongs in the player and resets with each source.
- Downloads: storage usage, quality, host folder, simultaneous series, and storage limit. Downloads stop when disk space is low.
- Accessibility: reduced motion, interface size, and keyboard shortcuts.
- Data: export/import, watch history clearing, and preference reset. Shared devices receive library and preference changes. Backups exclude credentials and downloaded media.
- Sharing, desktop only: local network sharing, link pairing, per-device revocation, link reset, and background operation. Host-only routes reject remote actions.
- About: package version and desktop update checks. Updates install only after the user clicks Install update.

Providers is a heading within Playback, styled like the page title, with no refresh action. Otherwise, never add subheadings, category descriptions, redundant status labels, or save notices. Give options intuitive names. Add descriptions only for information the name cannot convey, and use the shortest possible wording, preferably one line. Never add walls of text. Errors and actionable feedback must remain visible.

Import components from `./controls`. `SettingRow` binds its label and optional description to controls through a child function:

```tsx
<SettingsCard>
  <SettingRow title="Subtitles">
    {binding => <SettingsToggle {...binding} checked={preferences.subtitles} onChange={subtitles => update({ subtitles })} />}
  </SettingRow>
</SettingsCard>
```

Use regular children for actions and read-only values. Controls retain native keyboard behavior and disabled states. The fixture in `tests/fixtures/settings-controls.html` exercises the reusable controls.

Add a preference's default and validation in `src/preferences.ts`, expose it with `usePreferences().update`, and wire it to its consumer. Preferences persist separately from library data, synchronize across tabs, and report storage failures. Existing preferences remain stored when their controls are removed. Provider selection and fallback remain automatic for new profiles; volume and speed belong in the player.


Buttons use icons with text, pink for primary actions, and muted red for destructive actions. Reuse the existing controls. Keep new elements aligned with the settings typography, spacing, and colors.

Motion is limited to feedback. Buttons press at 160ms and switch thumbs move at 160ms with the existing ease-out token. Rows, profile content, previews, and category navigation do not stagger or animate on entry. Reduced motion removes press scaling and thumb movement.
