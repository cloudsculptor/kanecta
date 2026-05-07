const { buildConstitution, buildWorkplan } = require('./build');
const chokidar = require('chokidar');
const browserSync = require('browser-sync').create();
const path = require('path');

const ADOC = path.resolve(__dirname, 'constitution.adoc');
const MD = path.resolve(__dirname, 'WORKPLAN.md');

browserSync.init({
  server: __dirname,
  index: 'index.html',
  open: true,
  notify: true,
  ui: false,
});

chokidar.watch(ADOC).on('change', () => {
  buildConstitution();
  browserSync.reload('index.html');
});

chokidar.watch(MD).on('change', () => {
  buildWorkplan();
  browserSync.reload('workplan.html');
});

console.log('Watching constitution.adoc and WORKPLAN.md — browser will live-reload on changes.');
