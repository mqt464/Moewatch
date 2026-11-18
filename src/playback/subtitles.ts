export type Cue = { start: number; end: number; text: string };
const seconds = (value: string) => value.trim().replace(',', '.').split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
export function parseSubtitles(raw: string, format: string): Cue[] {
  const cues: Cue[] = [];
  if (format === 'ass') {
    // shortcut: ASS is rendered as plain dialogue, not positioned/typeset karaoke.
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('Dialogue:')) continue;
      const fields = line.slice(9).split(',');
      if (fields.length >= 10) cues.push({ start: seconds(fields[1]), end: seconds(fields[2]), text: fields.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ') });
    }
  } else {
    for (const block of raw.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n'); const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0) continue;
      const [start, end] = lines[index].split('-->');
      cues.push({ start: seconds(start), end: seconds(end.trim().split(/\s/)[0]), text: lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ') });
    }
  }
  return cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.text).sort((a,b) => a.start-b.start);
}
export function clock(time: number) { const value = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
