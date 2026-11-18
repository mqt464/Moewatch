import { useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import './settings.css';

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return <section className="settings-section" aria-labelledby={id}><div className="settings-section-heading"><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{children}</section>;
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="settings-card">{children}</div>;
}

type FieldBinding = { id: string; 'aria-describedby'?: string };

export function SettingRow({ title, description, stacked = false, disabled = false, children }: { title: ReactNode; description?: string; stacked?: boolean; disabled?: boolean; children: ReactNode | ((binding: FieldBinding) => ReactNode) }) {
  const id = useId();
  const isField = typeof children === 'function';
  const descriptionId = description ? `${id}-description` : undefined;
  return <div aria-disabled={disabled || undefined} className={`setting-row${stacked ? ' setting-row-stacked' : ''}`}><div className="setting-copy">{isField ? <label className="setting-title" htmlFor={id}>{title}</label> : <span className="setting-title">{title}</span>}{description && <p id={descriptionId}>{description}</p>}</div><div className="setting-control">{isField ? children({ id, 'aria-describedby': descriptionId }) : children}</div></div>;
}

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { onChange: (checked: boolean) => void };

export function SettingsToggle({ onChange, ...props }: ToggleProps) {
  return <span className="settings-toggle"><input {...props} type="checkbox" role="switch" onChange={event => onChange(event.target.checked)} /><span aria-hidden="true" /></span>;
}

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & { value: number; min?: number; max?: number; unit?: string; onChange: (value: number) => void };

export function SettingsSlider({ value, min = 0, max = 100, unit = '', onChange, ...props }: SliderProps) {
  const output = `${value}${unit}`;
  return <div className="settings-slider-control"><input {...props} className="settings-slider" type="range" min={min} max={max} value={value} aria-valuetext={output} style={{ '--slider-fill': `${max > min ? (value - min) / (max - min) * 100 : 0}%` } as CSSProperties} onChange={event => onChange(Number(event.target.value))} /><output htmlFor={props.id}>{output}</output></div>;
}

export function SettingsSelect({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="settings-select"><select {...props}>{children}</select><ChevronDown aria-hidden="true" size={14} /></span>;
}

export function SettingsInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`settings-input ${props.className || ''}`} />;
}

export function SettingsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`settings-input settings-textarea ${props.className || ''}`} />;
}

export function SettingsCheckbox({ children, onChange, ...props }: Omit<ToggleProps, 'children'> & { children: ReactNode }) {
  const id = useId();
  return <label className="settings-checkbox" htmlFor={props.id || id}><input {...props} id={props.id || id} type="checkbox" onChange={event => onChange(event.target.checked)} />{children}</label>;
}

type ChoiceProps = { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean };

export function SettingsChoices({ label, value, options, onChange, disabled = false, segmented = false }: ChoiceProps & { segmented?: boolean }) {
  const name = useId();
  return <fieldset className={`settings-choices${segmented ? ' settings-segmented' : ''}`} disabled={disabled}><legend className="sr-only">{label}</legend>{options.map(option => <label key={option.value}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.label}</span></label>)}</fieldset>;
}

export function SettingsButton({ children, variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  return <button {...props} type={props.type || 'button'} className={`settings-action settings-action-${variant} ${props.className || ''}`}>{children}</button>;
}

export function SettingsNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`settings-notice${error ? ' settings-notice-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>;
}
