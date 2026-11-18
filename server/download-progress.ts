export class DownloadRate {
  private samples: { time: number; bytes: number }[];
  private bytes = 0;

  constructor(now = Date.now()) { this.samples = [{ time: now, bytes: 0 }]; }

  update(bytes: number, now = Date.now()) {
    this.bytes = Math.max(this.bytes, bytes);
    if (now - this.samples.at(-1)!.time >= 250) this.samples.push({ time: now, bytes: this.bytes });
    while (this.samples.length > 1 && this.samples[1].time <= now - 5000) this.samples.shift();
  }

  perSecond(now = Date.now()) {
    if (now - this.samples.at(-1)!.time >= 250) this.samples.push({ time: now, bytes: this.bytes });
    while (this.samples.length > 1 && this.samples[1].time <= now - 5000) this.samples.shift();
    const first = this.samples[0];
    return Math.max(0, (this.bytes - first.bytes) / Math.min(5, Math.max(.1, (now - first.time) / 1000)));
  }
}
