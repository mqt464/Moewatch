import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { SettingRow, SettingsButton, SettingsCard, SettingsCheckbox, SettingsChoices, SettingsInput, SettingsNotice, SettingsSection, SettingsSelect, SettingsSlider, SettingsTextarea, SettingsToggle } from '../../src/settings/controls';

function Fixture() {
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(50);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [choice, setChoice] = useState('first');
  const [segment, setSegment] = useState('first');
  const [select, setSelect] = useState('first');
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState('');
  const options = [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }];
  return <main className="settings-layout"><div /><div className="settings-content"><h1>Settings controls</h1><SettingsSection title="Inputs"><SettingsCard>
    <SettingRow title="Toggle" description="Toggle description.">{binding => <SettingsToggle {...binding} checked={enabled} onChange={setEnabled} />}</SettingRow>
    <SettingRow title="Slider">{binding => <SettingsSlider {...binding} value={volume} unit="%" onChange={setVolume} />}</SettingRow>
    <SettingRow title="Dropdown">{binding => <SettingsSelect {...binding} value={select} onChange={event => setSelect(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</SettingsSelect>}</SettingRow>
    <SettingRow title="Name">{binding => <SettingsInput {...binding} value={name} onChange={event => setName(event.target.value)} />}</SettingRow>
    <SettingRow title="Notes" stacked>{binding => <SettingsTextarea {...binding} value={notes} onChange={event => setNotes(event.target.value)} />}</SettingRow>
    <SettingRow title="Checkbox"><SettingsCheckbox checked={checked} onChange={setChecked}>Enable checkbox</SettingsCheckbox></SettingRow>
    <SettingRow title="Radio buttons"><SettingsChoices label="Radio choice" options={options} value={choice} onChange={setChoice} /></SettingRow>
    <SettingRow title="Segments"><SettingsChoices label="Segment choice" options={options} value={segment} onChange={setSegment} segmented /></SettingRow>
    <SettingRow title="Disabled toggle">{binding => <SettingsToggle {...binding} checked disabled onChange={() => {}} />}</SettingRow>
    <SettingRow title="Disabled input">{binding => <SettingsInput {...binding} disabled value="Unavailable" />}</SettingRow>
    <SettingRow title="Action"><SettingsButton onClick={() => setStatus('Action complete')}>Run action</SettingsButton></SettingRow>
  </SettingsCard></SettingsSection>{status && <SettingsNotice>{status}</SettingsNotice>}</div></main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
