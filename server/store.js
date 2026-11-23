// A tiny JSON-file database. Two people logging glasses of water is a very
// small amount of data, so everything lives in memory and is written to disk
// (atomically) right after each change, so a restart or redeploy loses nothing.

import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ vapid: null, rooms: {}, sessions: {}, subscriptions: {} });

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = EMPTY();
    if (fs.existsSync(this.file)) {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
  }

  save() {
    this.flush();
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
