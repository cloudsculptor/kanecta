const { buildConstitution, buildSlides } = require('./build');
const chokidar = require('chokidar');
const browserSync = require('browser-sync').create();
const path = require('path');

const ADOC = path.resolve(__dirname, 'constitution/constitution.adoc');
const SLIDES = path.resolve(__dirname, 'slides/slides.adoc');

browserSync.init({
  server: path.resolve(__dirname, 'build'),
  index: 'slides.html',
  open: true,
  notify: true,
  ui: false,
});

chokidar.watch(ADOC).on('change', () => {
  buildConstitution();
  browserSync.reload('index.html');
});

chokidar.watch(SLIDES).on('change', () => {
  buildSlides();
  browserSync.reload('slides.html');
});

console.log('Watching constitution.adoc and slides/slides.adoc — browser will live-reload on changes.');
