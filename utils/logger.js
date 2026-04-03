import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Logger {
  constructor(prefix) {
    this.prefix = prefix;
  }

  info(...args) {
    console.log(`[${new Date().toISOString()}] [${this.prefix}]`, ...args);
  }

  warn(...args) {
    console.warn(`[${new Date().toISOString()}] [${this.prefix}]`, ...args);
  }

  error(...args) {
    console.error(`[${new Date().toISOString()}] [${this.prefix}]`, ...args);
  }

  debug(...args) {
    if (process.env.DEBUG) {
      console.debug(`[${new Date().toISOString()}] [${this.prefix}]`, ...args);
    }
  }
}
