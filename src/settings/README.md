# Settings UI

Follow Rei's settings structure: a narrow category sidebar, one page title, and bordered cards with divided rows. Keep Moewatch's colors, focus rings, and 44px interaction targets. On phones, categories form a horizontal navigation row.

Only expose settings that provide value. Current categories:

- Account: AniList sign-in, sign-out, and manual sync.
- Appearance: homepage row order, visibility, hero visibility, and watching card style.
- Integrations, desktop only: Discord activity and watchparty toggles.
- Playback: preferred audio, subtitles, download quality, host download folder, storage usage, and read-only provider configuration status.
- Shared access, desktop only: LAN sharing, the connection link, and background operation from the system tray.
- About: package version and desktop update checks. Updates install only after the user clicks Install update.

Provider status is a heading within Playback, styled like the page title, with no refresh action. Otherwise, never add subheadings, category descriptions, redundant status labels, or save notices. Give options intuitive names. Add descriptions only for information the name cannot convey, and keep them to one or two short lines. Errors and actionable feedback must remain visible.

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

