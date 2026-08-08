#!/usr/bin/env node
// bin/anther.js —— 发布形态入口（构建后指向 dist/server/cli.js）
import { main } from '../dist/server/cli.js';
main(process.argv.slice(2)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
