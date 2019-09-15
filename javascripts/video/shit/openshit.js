'use strict';

const params = new URL(location).searchParams;
const censored = params.get('censored');
const warnBeforeClosing = !params.get('easy-reload');

const loadBtn = document.getElementById('load');
const fileBtn = document.getElementById('file');
const helpBtn = document.getElementById('help');
const addBtn = document.getElementById('add');
const startBtn = document.getElementById('start');
const prevBtn = document.getElementById('prev');
const playBtn = document.getElementById('play');
const nextBtn = document.getElementById('next');
const textBtn = document.getElementById('text');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const zoomOutBtn = document.getElementById('out');
const zoomInBtn = document.getElementById('in');

const propertiesList = document.getElementById('properties');
const playIcon = document.getElementById('icon');
const currentSpan = document.getElementById('current');
const lengthSpan = document.getElementById('length');

const scrollWrapper = document.getElementById('scroll');
const timeMarkers = document.getElementById('axis');
const layersWrapper = document.getElementById('layers');
const playheadMarker = document.getElementById('playhead');

const modalCover = document.getElementById('modal-cover');

const preview = document.getElementById('preview');
const c = preview.getContext('2d');

const easingEditor = new EasingEditor();

const LEFT = 100;

const BASE_SCALE = 3;
const MAX_SCALE = 5;
let logScale = 1, scale = BASE_SCALE * 2 ** logScale;
zoomOutBtn.addEventListener('click', e => {
  if (logScale > 0) {
    updateScale(BASE_SCALE * 2 ** --logScale);
  }
});
zoomInBtn.addEventListener('click', e => {
  if (logScale < MAX_SCALE) {
    updateScale(BASE_SCALE * 2 ** ++logScale);
  }
});
function renderScale() {
  while (timeMarkers.firstChild) timeMarkers.removeChild(timeMarkers.firstChild);
  const majorStep = 20 * 2 ** (-logScale);
  const step = 2 * 2 ** (-logScale);
  const minTime = Math.floor((scrollX - LEFT) / scale / step) * step;
  const maxTime = Math.ceil((scrollX + windowWidth) / scale / step) * step;
  for (let t = Math.max(minTime, 0); t <= maxTime; t += step) {
    timeMarkers.appendChild(Elem('span', {
      className: ['marker', t % majorStep === 0 ? 'major' : null],
      style: {
        left: t * scale + 'px'
      }
    }, [t % majorStep === 0 ? t + 's' : '']));
  }
}
window.requestAnimationFrame(renderScale);

let scrollX = scrollWrapper.scrollLeft, scrollY = scrollWrapper.scrollTop;
scrollWrapper.addEventListener('scroll', e => {
  scrollX = scrollWrapper.scrollLeft;
  scrollY = scrollWrapper.scrollTop;
  renderScale();
});

let windowWidth = window.innerWidth, windowHeight = window.innerHeight;
window.addEventListener('resize', e => {
  windowWidth = window.innerWidth;
  windowHeight = window.innerHeight;
  renderScale();
});

let previewTime, wasPlaying, editorLength;
isDragTrigger(scrollWrapper, (e, switchControls) => {
  const closest = e.target.closest('.track');
  if (closest && !closest.classList.contains('selected')) {
    switchControls(null);
  } else {
    if (playing) {
      wasPlaying = true;
      stop();
    } else {
      wasPlaying = false;
    }
    if (Track.selected && !closest) {
      Track.selected.unselected();
    }
    window.requestAnimationFrame(() => {
      previewTimeAt(Math.max((e.clientX + scrollX - LEFT) / scale, 0))
    });
  }
}, e => {
  previewTimeAt(Math.max((e.clientX + scrollX - LEFT) / scale, 0));
}, e => {
  if (wasPlaying) play();
});
function setPreviewTime(time) {
  let wasPlaying = playing;
  if (wasPlaying) stop();
  previewTimeAt(time);
  if (wasPlaying) play();
}
previewTimeAt(0);

addLayer();

isDragTrigger(textBtn, (e, switchControls) => {
  const track = new TextTrack();
  track.dragStart(e, [5, 5], true);
  switchControls([track.dragMove, track.dragEnd]);
});

addBtn.addEventListener('change', async e => {
  addBtn.disabled = true;
  for (const file of addBtn.files) {
    const source = new (toSource(file.type))(file);
    if (source) {
      addBtn.parentNode.insertBefore(source.elem, addBtn);
      await source.ready;
    } else {
      console.log(file);
    }
  }
  addBtn.disabled = false;
});

const undoHistory = [];
const redoHistory = [];
let saved = false;
function log(entry = getEntry()) {
  undoHistory.push(entry);
  redoHistory.splice(0, redoHistory.length);
  undoBtn.disabled = !undoHistory.length;
  redoBtn.disabled = !redoHistory.length;
  saved = false;
}
undoBtn.addEventListener('click', e => {
  if (undoHistory.length) {
    redoHistory.push(getEntry());
    const entry = undoHistory.pop();
    setEntry(entry);
    undoBtn.disabled = !undoHistory.length;
    redoBtn.disabled = !redoHistory.length;
  }
});
redoBtn.addEventListener('click', e => {
  if (redoHistory.length) {
    undoHistory.push(getEntry());
    const entry = redoHistory.pop();
    setEntry(entry);
    undoBtn.disabled = !undoHistory.length;
    redoBtn.disabled = !redoHistory.length;
  }
});

playBtn.addEventListener('click', e => {
  if (playing) stop();
  else play();
});

startBtn.addEventListener('click', e => {
  setPreviewTime(0);
});
prevBtn.addEventListener('click', e => {
  const jumpPoints = getAllJumpPoints();
  const goodTime = jumpPoints.findIndex(t => t >= previewTime);
  if (goodTime === 0 || !jumpPoints.length) setPreviewTime(0);
  else if (~goodTime) setPreviewTime(jumpPoints[goodTime - 1]);
  else setPreviewTime(jumpPoints[jumpPoints.length - 1]);
});
nextBtn.addEventListener('click', e => {
  const jumpPoints = getAllJumpPoints();
  const goodTime = jumpPoints.find(t => t > previewTime);
  if (goodTime) setPreviewTime(goodTime);
});

let currentModal = null;
function modal(modal) {
  const closeBtn = modal.querySelector('.close');
  closeBtn.addEventListener('click', e => {
    modalCover.classList.remove('show');
    modal.classList.remove('show');
    currentModal = null;
  });
  return () => {
    modalCover.classList.add('show');
    modal.classList.add('show');
    currentModal = closeBtn;
  };
}
modalCover.addEventListener('click', e => {
  if (currentModal && e.target === modalCover) currentModal.click();
});

document.addEventListener('keydown', e => {
  if (playing && playing.exporting) {
    if (e.key === 'Escape') playing.exporting(false);
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  let preventDefault = true;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'ArrowLeft') {
      if (e.shiftKey) startBtn.click();
      else prevBtn.click();
    } else if (e.key === 'ArrowRight') {
      if (e.shiftKey) setPreviewTime(editorLength);
      else nextBtn.click();
    } else if (e.key === 'z') {
      undoBtn.click();
    } else if (e.key === 'Z' || e.key === 'y') {
      redoBtn.click();
    } else {
      preventDefault = false;
    }
  } else if (e.key === 'ArrowLeft') {
    if (e.shiftKey) setPreviewTime(previewTime - 10);
    else if (e.altKey) setPreviewTime(previewTime - 0.1);
    else setPreviewTime(previewTime - 1);
  } else if (e.key === 'ArrowRight') {
    if (e.shiftKey) setPreviewTime(previewTime + 10);
    else if (e.altKey) setPreviewTime(previewTime + 0.1);
    else setPreviewTime(previewTime + 1);
  } else if (e.key === ' ') {
    playBtn.click();
  } else if (e.key === '-') {
    zoomOutBtn.click();
  } else if (e.key === '=' || e.key === '+') {
    zoomInBtn.click();
  } else if (e.key === 'Delete') {
    if (Track.selected) Track.deleteSelected();
  } else if (e.key === 'Escape') {
    if (currentModal) {
      currentModal.click();
    } else {
      preventDefault = false;
    }
  } else {
    preventDefault = false;
  }
  if (preventDefault) e.preventDefault();
});

const fileMenu = new Menu([
  {elem: Elem('label', {for: 'load'}, ['Open'])},
  {label: 'Save', fn: saveProject},
  {label: 'Video settings', fn: modal(document.getElementById('vid-settings-modal'))},
  {label: 'Export', fn: censored && exportVideo}
]);
fileBtn.addEventListener('click', e => {
  const {left, bottom} = fileBtn.getBoundingClientRect();
  fileMenu.open(left, bottom);
});
const helpMenu = new Menu([
  {label: 'How to use', fn: modal(document.getElementById('help-modal'))},
  {label: 'Keyboard shortcuts', fn: modal(document.getElementById('shortcuts-modal'))},
  {label: 'About', fn: modal(document.getElementById('about-modal'))}
]);
helpBtn.addEventListener('click', e => {
  const {left, bottom} = helpBtn.getBoundingClientRect();
  helpMenu.open(left, bottom);
});

function saveProject() {
  fileMenu.items[1].disabled = true;
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify({
    version: 1,
    entry: getEntry(),
    src: Object.values(sources).filter(({file}) => file),
    fonts: [] // TODO: store fonts too
  }));
  Object.values(sources).forEach(({id, file}) => {
    if (file) zip.file(id, file);
  })
  zip.generateAsync({type: 'blob'}).then(blob => {
    const url = URL.createObjectURL(blob);
    const saveLink = document.createElement('a');
    saveLink.href = url;
    saveLink.download = 'project.oshit';
    document.body.appendChild(saveLink);
    saveLink.click();
    document.body.removeChild(saveLink);
    URL.revokeObjectURL(url);
    fileMenu.items[1].disabled = false;
    saved = true;
  });
}
loadBtn.addEventListener('change', e => {
  if (loadBtn.files[0]) {
    loadBtn.disabled = true;
    JSZip.loadAsync(loadBtn.files[0])
      .then(zip =>
        zip.file('project.json').async('text')
          .then(async json => {
            const {entry, src} = JSON.parse(json);
            addBtn.disabled = true;
            for (const {id, type} of src) {
              const blob = new Blob([await zip.file(id).async('arraybuffer')], {type});
              sources[id] = new (toSource(type))(blob, id);
              addBtn.parentNode.insertBefore(sources[id].elem, addBtn);
              await sources[id].ready;
            }
            addBtn.disabled = false;
            setEntry(entry);
          }))
      .catch(e => {
        console.log(e);
        loadBtn.disabled = false;
      });
  }
});

if (warnBeforeClosing) {
  window.addEventListener('beforeunload', e => {
    if (!saved && (undoHistory.length || redoHistory.length)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

document.addEventListener('contextmenu', e => {
  e.preventDefault();
});

if (censored) {
  document.body.classList.add('censored');
  fileMenu.items[3].disabled = true;
  window.history.replaceState({}, '', '../censored.html');
  document.title = '';
}
