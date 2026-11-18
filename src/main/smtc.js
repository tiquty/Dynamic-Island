'use strict';
// Мост к мультимедиа Windows. Запускает smtc.ps1 (Windows PowerShell), который раз в секунду
// присылает, что сейчас играет в других приложениях, и принимает команды управления.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let proc = null;
let onUpdate = null;
let stopped = true;
let buffer = '';
let thumb = null; // { buf, type, ver }
let quickExits = 0;

const tmp = (name) => path.join(app.getPath('temp'), name);
const scriptFile = () => tmp('island-player-smtc.ps1');
const cmdFile = () => tmp('island-player-smtc.cmd');

function parseThumb(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  thumb = m ? { buf: Buffer.from(m[2], 'base64'), type: m[1], ver: (thumb ? thumb.ver : 0) + 1 } : null;
}

function handleLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (!m.active) return onUpdate(null);
  if ('thumb' in m) parseThumb(m.thumb);
  onUpdate({
    title: m.title || '', artist: m.artist || '', playing: !!m.playing,
    position: m.pos || 0, duration: Math.max(0, m.dur || 0), app: m.app || '', thumbVer: thumb ? thumb.ver : 0,
  });
}

function start(cb) {
  if (proc) return;
  onUpdate = cb;
  stopped = false;
  const startedAt = Date.now();
  fs.writeFileSync(scriptFile(), '\ufeff' + fs.readFileSync(path.join(__dirname, 'smtc.ps1'), 'utf8'), 'utf8');
  fs.rmSync(cmdFile(), { force: true });

  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile(), cmdFile()], { windowsHide: true });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) handleLine(line);
    }
  });
  proc.on('error', () => {});
  proc.on('exit', () => {
    proc = null;
    onUpdate(null);
    quickExits = Date.now() - startedAt < 5000 ? quickExits + 1 : 0;
    if (!stopped && quickExits < 3) setTimeout(() => start(cb), 3000);
  });
}

function stop() {
  stopped = true;
  if (proc) { proc.kill(); proc = null; }
}

// cmd: { type: 'toggle' | 'pause' | 'next' | 'prev' | 'seek', ms }
function send(cmd) {
  if (!proc) return;
  try { fs.writeFileSync(cmdFile(), cmd.type === 'seek' ? `seek ${Math.round(cmd.ms)}` : cmd.type); } catch { /* не критично */ }
}

const getThumb = () => thumb;

module.exports = { start, stop, send, getThumb };
