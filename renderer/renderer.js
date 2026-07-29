import { BrowserPcmCapture } from '../src/core/browser-pcm-capture.mjs';
import { BrowserOutputTone } from '../src/core/browser-output-tone.mjs';
import {
  AUDIO_DIAGNOSTIC_DEFAULTS,
  activateAudioDiagnostic,
  beginAudioDiagnostic,
  createAudioDiagnosticState,
  describeAudioDiagnostic,
  failAudioDiagnostic,
  recordAudioDiagnosticPcm,
  stopAudioDiagnostic,
} from '../src/core/audio-diagnostic-policy.mjs';
import {
  applyOutputSelection,
  buildAudioDeviceOptions,
  buildMicrophoneConstraints,
  describeEffectiveInput,
  normalizeAudioDeviceId,
} from '../src/core/audio-device-policy.mjs';
import { systemCaptureFailureMessage } from '../src/core/system-capture-status.mjs';
import { applicationSourceLabel } from '../src/core/application-capture-scope.mjs';

/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const cue = window.cue; // exposed by preload
  const $ = (s) => document.querySelector(s);
  const cmdKey = cue.platform === 'darwin' ? '⌘' : 'Ctrl';
  const isCmdOrCtrl = (e) => (cue.platform === 'darwin' ? e.metaKey : e.ctrlKey);
  const DEFAULT_ASSIST_SHORTCUT = 'CommandOrControl+Return';

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('logo', { size: 18 });
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  $('#stop-btn').innerHTML = icon('stop-square', { size: 15 });
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', {
    size: 16,
  });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', {
    size: 16,
  });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('refresh-cw', {
    size: 16,
  });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('more-horizontal', { size: 18 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null; // current streaming <div class="ai-text">
  let caretEl = null;
  let assistShortcut = DEFAULT_ASSIST_SHORTCUT;
  let recordingShortcut = false;
  let captureActive = false;
  let effectiveInput = null;
  let effectiveOutput = null;
  let availableInputIds = new Set(['default']);
  let availableOutputLabels = new Map([['default', 'system default']]);
  let applicationInventory = null;
  let requestedApplicationScope = null;
  let effectiveApplicationScope = null;
  const cuePlayback = new Audio();
  let diagnosticState = createAudioDiagnosticState();
  let diagnosticGeneration = 0;
  let diagnosticHealthTimer = null;
  let diagnosticAutoStopTimer = null;
  let diagnosticTransition = Promise.resolve();
  let powerTransition = Promise.resolve();

  const messages = $('#messages');

  function esc(s) {
    return s.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  }

  function shortcutParts(accelerator) {
    const labels = {
      CommandOrControl: cue.platform === 'darwin' ? '⌘' : 'Ctrl',
      Command: '⌘',
      Control: 'Ctrl',
      Super: 'Super',
      Alt: cue.platform === 'darwin' ? '⌥' : 'Alt',
      Shift: cue.platform === 'darwin' ? '⇧' : 'Shift',
      Return: 'Enter',
      Escape: 'Esc',
      Space: 'Space',
      Up: '↑',
      Down: '↓',
      Left: '←',
      Right: '→',
    };
    return (accelerator || DEFAULT_ASSIST_SHORTCUT).split('+').map((part) => labels[part] || part);
  }

  function shortcutKeycapsHtml(accelerator, className) {
    const cls = className || 'keycap';
    return shortcutParts(accelerator)
      .map((part) => '<span class="' + cls + '">' + esc(part) + '</span>')
      .join(' ');
  }

  function syncAssistShortcutLabels() {
    const shortcutBtn = $('#shortcut-assist');
    if (shortcutBtn && !recordingShortcut)
      shortcutBtn.textContent = shortcutParts(assistShortcut).join(' + ');
    const placeholder = $('#placeholder');
    if (placeholder)
      placeholder.innerHTML =
        'Ask about your screen or conversation, or ' +
        shortcutKeycapsHtml(assistShortcut) +
        ' for Assist';
  }

  // minimal, safe markdown: fenced code, bullets, inline code, bold, paragraphs
  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '',
      inCode = false,
      inList = false,
      buf = [];
    const flushP = () => {
      if (buf.length) {
        html += '<p>' + inline(buf.join(' ')) + '</p>';
        buf = [];
      }
    };
    const inline = (s) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) {
          flushP();
          if (inList) {
            html += '</ul>';
            inList = false;
          }
          html += '<pre><code>';
          inCode = true;
        } else {
          html += '</code></pre>';
          inCode = false;
        }
        continue;
      }
      if (inCode) {
        html += esc(line) + '\n';
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        flushP();
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>';
        continue;
      }
      if (line.trim() === '') {
        flushP();
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        continue;
      }
      buf.push(line.trim());
    }
    flushP();
    if (inList) html += '</ul>';
    if (inCode) html += '</code></pre>';
    return html;
  }

  function clearMessages() {
    messages.innerHTML = '';
    aiEl = null;
    caretEl = null;
  }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small) {
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    aiEl.insertBefore(span, caretEl);
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null;
    caretEl = null;
  }

  function setBusy(v) {
    busy = v;
    $('#send-btn').classList.toggle('busy', v);
  }

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text) {
    if (busy) return;
    setBusy(true);
    cue.ask({ mode, text: text || '' });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  function syncPlaceholder() {
    placeholder.classList.toggle(
      'hidden',
      input.value.length > 0 || document.activeElement === input,
    );
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  input.addEventListener('input', syncPlaceholder);
  input.addEventListener('focus', () => {
    composer.classList.add('focused');
    placeholder.classList.add('hidden');
  });
  input.addEventListener('blur', () => {
    composer.classList.remove('focused');
    syncPlaceholder();
  });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) {
      runMode('assist', '');
      return;
    }
    input.value = '';
    syncPlaceholder();
    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    const captured = keyEventToAccelerator(e);
    if (
      captured.accelerator &&
      captured.accelerator.toLowerCase() === assistShortcut.toLowerCase()
    ) {
      e.preventDefault();
      runMode('assist', '');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      send();
    }
  });

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    await cue.settingsSet({ smart: settings.smart });
  });

  // Hide / collapse
  $('#hide-btn').addEventListener('click', () => {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#hide-btn').classList.toggle('collapsed', collapsed);
    $('#live-dot').style.display = collapsed ? 'none' : '';
  });

  $('#stop-btn').addEventListener('click', () => cue.captureToggle());

  // ---- capture: selected microphone --------------------------------------
  const browserAudioDependencies = {
    createAudioContext: () => new AudioContext({ sampleRate: 16000 }),
    createMediaStream: (tracks) => new MediaStream(tracks),
    createWorkletNode: (context, name) => new AudioWorkletNode(context, name),
    processorModuleUrl: './pcm-processor.js',
    processorName: 'pcm-processor',
  };

  const microphoneCapture = new BrowserPcmCapture({
    ...browserAudioDependencies,
    channel: 'microphone',
    openStream: () =>
      navigator.mediaDevices.getUserMedia(
        buildMicrophoneConstraints(currentAudioDeviceId('inputId')),
      ),
    onStarted: () => cue.log('microphone audio: capturing'),
    onPcm: (pcm) => cue.micPcm(pcm),
  });

  const microphoneDiagnosticCapture = new BrowserPcmCapture({
    ...browserAudioDependencies,
    channel: 'microphone-diagnostic',
    openStream: () =>
      navigator.mediaDevices.getUserMedia(
        buildMicrophoneConstraints(currentAudioDeviceId('inputId')),
      ),
    onStarted: () => cue.log('microphone diagnostic: capturing locally'),
    onPcm: (pcm) => {
      diagnosticState = recordAudioDiagnosticPcm(diagnosticState, pcm);
    },
  });

  const outputDiagnosticTone = new BrowserOutputTone({
    target: cuePlayback,
    createAudioContext: () => new AudioContext(),
    setTimeoutFn: (callback, delay) => setTimeout(callback, delay),
    clearTimeoutFn: (timer) => clearTimeout(timer),
    durationMs: AUDIO_DIAGNOSTIC_DEFAULTS.toneDurationMs,
    frequencyHz: AUDIO_DIAGNOSTIC_DEFAULTS.toneFrequencyHz,
    gainValue: AUDIO_DIAGNOSTIC_DEFAULTS.toneGain,
  });

  function startCapture(capture, label) {
    return capture.start().catch((error) => {
      cue.log(label + ' audio error: ' + (error && error.message));
      if (label === 'microphone') {
        effectiveInput = null;
        const code = error && error.code ? error.code : 'initialization-failed';
        setDeviceStatus('#audio-input-effective', 'Input unavailable: ' + code, 'error');
        showStatus(
          'Microphone capture degraded: ' + code + '. cue did not switch to another input.',
        );
      }
      return null;
    });
  }

  function stopCapture(capture, label) {
    capture
      .stop()
      .catch((error) => cue.log(label + ' audio stop error: ' + (error && error.message)));
  }

  async function startMic() {
    const resource = await startCapture(microphoneCapture, 'microphone');
    if (!resource) return null;
    const track = resource.stream.getAudioTracks()[0];
    effectiveInput = describeEffectiveInput(track, currentAudioDeviceId('inputId'));
    syncAudioDeviceStatus();
    return resource;
  }
  function stopMic() {
    stopCapture(microphoneCapture, 'microphone');
  }

  function setSystemCaptureHealthy() {
    $('#live-dot').classList.remove('degraded');
    const health = $('#capture-health');
    health.textContent = '';
    health.classList.add('hidden');
  }

  function setSystemCaptureFailure(code) {
    $('#live-dot').classList.add('degraded');
    const message = systemCaptureFailureMessage(code);
    const health = $('#capture-health');
    health.textContent = message;
    health.classList.remove('hidden');
    cue.log('capture degraded: ' + message);
  }

  // ---- events from main --------------------------------------------------
  cue.on('capture:state', ({ active }) => {
    captureActive = active;
    $('#live-dot').classList.toggle('off', !active);
    $('#stop-btn').classList.toggle('active', active);
    if (active) {
      startMic();
    } else {
      setSystemCaptureHealthy();
      stopMic();
    }
    renderApplicationInventory();
  });
  cue.on('system-capture:state', ({ status, code, scope }) => {
    document.documentElement.dataset.systemCaptureStatus = status;
    if (status === 'active') {
      effectiveApplicationScope = scope;
      setSystemCaptureHealthy();
    } else if (status === 'diagnostic') {
      effectiveApplicationScope = null;
      setSystemCaptureFailure('unverified-capture-scope');
    } else if (status === 'error') {
      effectiveApplicationScope = null;
      setSystemCaptureFailure(code || 'initialization-failed');
    } else if (status === 'idle') {
      effectiveApplicationScope = null;
    }
    renderApplicationInventory();
  });
  cue.on('llm:start', ({ userBubble, small }) => {
    clearMessages();
    if (userBubble) addUserBubble(userBubble);
    startAi(!!small);
    setBusy(true);
  });
  cue.on('llm:token', ({ text }) => appendToken(text));
  cue.on('llm:done', () => {
    finalizeAi();
    setBusy(false);
  });
  cue.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message;
    finalizeAi();
    setBusy(false);
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('cue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cue-status';
      const panel = document.getElementById('panel');
      panel.insertBefore(el, document.getElementById('action-row'));
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => {
    cue.log('[status] ' + message);
    showStatus(message);
  });
  cue.on('power:state', ({ status }) => {
    powerTransition = powerTransition.then(async () => {
      if (status === 'suspended') {
        document.documentElement.dataset.powerState = 'suspended';
        await queueDiagnosticTransition(stopMicrophoneDiagnostic);
        await outputDiagnosticTone.stop();
        effectiveInput = null;
        effectiveOutput = null;
        applicationInventory = null;
        requestedApplicationScope = null;
        effectiveApplicationScope = null;
        syncAudioDeviceStatus();
        renderApplicationInventory();
        showStatus('Mac is sleeping. Audio capture stopped.');
        return;
      }
      if (status === 'resumed') {
        document.documentElement.dataset.powerState = 'resumed';
        await refreshAudioDevices();
        await refreshApplicationInventory();
        showStatus(
          'Mac woke from sleep. Audio routes were refreshed; start capture explicitly.',
        );
      }
    });
  });

  // ---- settings ----------------------------------------------------------
  const scrim = $('#settings-scrim');
  function openSettings() {
    fillSettings();
    scrim.classList.remove('hidden');
    refreshAudioDevices();
    refreshApplicationInventory();
  }
  async function closeSettings() {
    cancelShortcutRecording();
    await queueDiagnosticTransition(stopMicrophoneDiagnostic);
    await outputDiagnosticTone.stop();
    await saveSettings();
    scrim.classList.add('hidden');
  }
  $('#more-btn').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', closeSettings);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) closeSettings();
  });

  function fillSettings() {
    document
      .querySelectorAll('#provider-seg button')
      .forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    $('#key-nvidia').value = settings.apiKeys.nvidia || '';
    $('#resume-context').value = settings.resumeContext || '';
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast;
    $('#model-smart').value = m.smart;
    ensureAudioDeviceSettings();
    syncAudioDeviceStatus();
    syncAssistShortcutLabels();
    $('#s-status').textContent = statusText();
  }
  $('#clear-resume').addEventListener('click', async () => {
    $('#resume-context').value = '';
    settings.resumeContext = '';
    await cue.settingsSet({ resumeContext: '' });
  });
  function statusText() {
    const k = settings.apiKeys;
    const has = [
      k.openai && 'OpenAI',
      k.anthropic && 'Anthropic',
      k.gemini && 'Gemini',
      k.nvidia && 'Nvidia',
    ].filter(Boolean);
    const stt = k.openai ? 'Whisper' : k.gemini ? 'Gemini' : 'none';
    return (
      'Active: ' +
      settings.provider +
      ' · keys: ' +
      (has.join(', ') || 'none set') +
      ' · transcription: ' +
      stt
    );
  }
  document.querySelectorAll('#provider-seg button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.provider = b.dataset.provider;
      document
        .querySelectorAll('#provider-seg button')
        .forEach((x) => x.classList.toggle('on', x === b));
      const m = settings.models[settings.provider] || { fast: '', smart: '' };
      $('#model-fast').value = m.fast;
      $('#model-smart').value = m.smart;
      $('#s-status').textContent = statusText();
    }),
  );
  async function saveSettings() {
    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    settings.apiKeys.nvidia = $('#key-nvidia').value.trim();
    settings.resumeContext = $('#resume-context').value.trim();
    if (!settings.models[settings.provider]) settings.models[settings.provider] = {};
    settings.models[settings.provider].fast = $('#model-fast').value.trim();
    settings.models[settings.provider].smart = $('#model-smart').value.trim();
    await cue.settingsSet(settings);
  }

  function ensureAudioDeviceSettings() {
    if (!settings.audioDevices) settings.audioDevices = {};
    settings.audioDevices.inputId = normalizeAudioDeviceId(settings.audioDevices.inputId);
    settings.audioDevices.outputId = normalizeAudioDeviceId(settings.audioDevices.outputId);
  }

  function currentAudioDeviceId(key) {
    ensureAudioDeviceSettings();
    return settings.audioDevices[key];
  }

  function renderDeviceOptions(select, options, selectedId) {
    select.innerHTML = '';
    options.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.label;
      option.disabled = !device.available;
      option.selected = device.id === selectedId;
      select.appendChild(option);
    });
  }

  function setDeviceStatus(selector, message, kind) {
    const element = $(selector);
    element.textContent = message;
    element.classList.toggle('error', kind === 'error');
    element.classList.toggle('success', kind === 'success');
  }

  function selectedApplicationSource() {
    if (!applicationInventory) return null;
    const value = $('#capture-application').value;
    return (
      applicationInventory.sources.find(
        (source) =>
          source.status === 'available' &&
          JSON.stringify([source.identity.pid, source.identity.bundleIdentifier]) === value,
      ) || null
    );
  }

  function renderApplicationInventory() {
    const select = $('#capture-application');
    const refresh = $('#capture-application-refresh');
    const status = $('#capture-application-status');
    const acknowledgement = $('#capture-browser-ack-wrap');
    const acknowledgementInput = $('#capture-browser-ack');
    select.innerHTML = '';
    acknowledgement.classList.add('hidden');
    acknowledgementInput.checked = false;

    const available = applicationInventory
      ? applicationInventory.sources.filter((source) => source.status === 'available')
      : [];
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = available.length
      ? 'Select an audible application'
      : 'No audible applications detected';
    select.appendChild(placeholder);
    for (const source of available) {
      const option = document.createElement('option');
      option.value = JSON.stringify([source.identity.pid, source.identity.bundleIdentifier]);
      option.textContent = applicationSourceLabel(source);
      option.disabled = source.outputDeviceUids.length === 0;
      option.selected =
        requestedApplicationScope?.responsiblePid === source.identity.pid &&
        requestedApplicationScope?.bundleIdentifier === source.identity.bundleIdentifier;
      select.appendChild(option);
    }
    const requestedSource = available.find(
      (source) =>
        requestedApplicationScope?.responsiblePid === source.identity.pid &&
        requestedApplicationScope?.bundleIdentifier === source.identity.bundleIdentifier,
    );
    if (requestedSource?.requiresBrowserWideAcknowledgement) {
      acknowledgement.classList.remove('hidden');
      acknowledgementInput.checked = requestedApplicationScope.browserWideAcknowledged;
    }
    select.disabled = captureActive || available.length === 0;
    refresh.disabled = captureActive;

    if (requestedApplicationScope) {
      status.textContent =
        'Requested: ' +
        requestedApplicationScope.displayName +
        (effectiveApplicationScope
          ? '. Effective: verified ' + effectiveApplicationScope.displayName + '.'
          : '. Effective: not verified until native capture starts.');
      status.className = 's-device-status success';
    } else {
      const unresolved = applicationInventory
        ? applicationInventory.sources.filter((source) => source.status === 'unresolved').length
        : 0;
      status.textContent =
        (available.length
          ? 'Select one application.'
          : 'No selectable audible application found.') +
        (unresolved ? ` ${unresolved} process source(s) could not be resolved.` : '') +
        ' Effective scope is not verified.';
      status.className = 's-device-status';
    }
  }

  async function refreshApplicationInventory() {
    const refresh = $('#capture-application-refresh');
    const status = $('#capture-application-status');
    if (captureActive) {
      renderApplicationInventory();
      return;
    }
    refresh.disabled = true;
    status.textContent = 'Detecting audible applications…';
    status.className = 's-device-status';
    try {
      const state = await cue.captureScopeInventory();
      applicationInventory = state.inventory;
      requestedApplicationScope = state.requestedScope;
      renderApplicationInventory();
    } catch (error) {
      applicationInventory = null;
      requestedApplicationScope = null;
      renderApplicationInventory();
      status.textContent =
        'Application detection failed: ' +
        (error && error.message ? error.message.split(':').at(-1).trim() : 'unknown');
      status.className = 's-device-status error';
    } finally {
      refresh.disabled = captureActive;
    }
  }

  async function requestSelectedApplicationScope() {
    const source = selectedApplicationSource();
    const acknowledgement = $('#capture-browser-ack-wrap');
    const acknowledgementInput = $('#capture-browser-ack');
    if (!source) {
      requestedApplicationScope = null;
      acknowledgement.classList.add('hidden');
      renderApplicationInventory();
      return;
    }
    acknowledgement.classList.toggle('hidden', !source.requiresBrowserWideAcknowledgement);
    if (source.requiresBrowserWideAcknowledgement && !acknowledgementInput.checked) {
      $('#capture-application-status').textContent =
        'Confirm browser-wide capture before selecting Google Chrome.';
      $('#capture-application-status').className = 's-device-status error';
      return;
    }
    try {
      requestedApplicationScope = await cue.captureScopeSelect({
        inventoryGeneration: applicationInventory.generation,
        responsiblePid: source.identity.pid,
        bundleIdentifier: source.identity.bundleIdentifier,
        browserWideAcknowledged: acknowledgementInput.checked,
      });
      renderApplicationInventory();
    } catch (error) {
      requestedApplicationScope = null;
      $('#capture-application-status').textContent =
        'Application selection failed: ' +
        (error && error.message ? error.message.split(':').at(-1).trim() : 'unknown');
      $('#capture-application-status').className = 's-device-status error';
    }
  }

  $('#capture-application-refresh').addEventListener('click', refreshApplicationInventory);
  $('#capture-application').addEventListener('change', requestSelectedApplicationScope);
  $('#capture-browser-ack').addEventListener('change', requestSelectedApplicationScope);

  function syncAudioDeviceStatus() {
    const requestedInput = currentAudioDeviceId('inputId');
    if (!availableInputIds.has(requestedInput)) {
      setDeviceStatus('#audio-input-effective', 'Selected input is unavailable', 'error');
    } else if (effectiveInput && effectiveInput.requestedId === requestedInput) {
      setDeviceStatus(
        '#audio-input-effective',
        'Effective: ' + effectiveInput.effectiveLabel,
        'success',
      );
    } else {
      setDeviceStatus(
        '#audio-input-effective',
        requestedInput === 'default'
          ? 'Effective: system default when capture starts'
          : 'Effective: verified when capture starts',
        '',
      );
    }

    const requestedOutput = currentAudioDeviceId('outputId');
    if (!availableOutputLabels.has(requestedOutput)) {
      setDeviceStatus('#audio-output-effective', 'Selected output is unavailable', 'error');
    } else if (effectiveOutput && effectiveOutput.requestedId === requestedOutput) {
      setDeviceStatus(
        '#audio-output-effective',
        'Effective: ' +
          (availableOutputLabels.get(effectiveOutput.effectiveId) || effectiveOutput.effectiveId),
        'success',
      );
    } else {
      setDeviceStatus('#audio-output-effective', 'Effective: not verified', '');
    }
  }

  function diagnosticIsRunning() {
    return diagnosticState.phase === 'starting' || diagnosticState.phase === 'active';
  }

  function clearDiagnosticTimers() {
    clearInterval(diagnosticHealthTimer);
    clearTimeout(diagnosticAutoStopTimer);
    diagnosticHealthTimer = null;
    diagnosticAutoStopTimer = null;
  }

  function diagnosticHealthLabel(status) {
    return (
      {
        waiting: 'Waiting for PCM frames',
        dead: 'No PCM frames received',
        silent: 'Frames received, signal is silent',
        healthy: 'Signal detected',
        idle: 'Idle',
      }[status] || status
    );
  }

  function renderMicrophoneDiagnostic() {
    const snapshot = describeAudioDiagnostic(diagnosticState, Date.now());
    const button = $('#audio-test-input');
    const status = $('#audio-diagnostic-status');
    const running = diagnosticIsRunning();
    button.textContent = running ? 'Stop microphone test' : 'Test selected microphone';
    button.classList.toggle('active', running);

    if (snapshot.phase === 'idle' && snapshot.frameCount === 0) {
      status.textContent = 'Not running. No audio leaves cue.';
      status.className = 's-diagnostic-status';
      return;
    }

    if (snapshot.phase === 'error') {
      status.textContent = 'Microphone test failed: ' + snapshot.errorCode;
      status.className = 's-diagnostic-status error';
      return;
    }

    const prefix =
      snapshot.phase === 'idle' ? 'Stopped' : diagnosticHealthLabel(snapshot.healthStatus);
    const inputLabel = snapshot.effectiveInput
      ? ' · input: ' + snapshot.effectiveInput.effectiveLabel
      : '';
    status.textContent =
      prefix +
      inputLabel +
      ' · RMS ' +
      Math.round(snapshot.rms) +
      ' · peak ' +
      snapshot.peak +
      ' · frames ' +
      snapshot.frameCount;
    status.className =
      's-diagnostic-status ' +
      (snapshot.healthStatus === 'healthy'
        ? 'success'
        : snapshot.healthStatus === 'dead'
          ? 'error'
          : '');
  }

  function queueDiagnosticTransition(operation) {
    diagnosticTransition = diagnosticTransition.then(operation, operation);
    return diagnosticTransition;
  }

  async function startMicrophoneDiagnostic() {
    if (diagnosticIsRunning()) return;
    const generation = ++diagnosticGeneration;
    diagnosticState = beginAudioDiagnostic(diagnosticState, Date.now());
    renderMicrophoneDiagnostic();

    let resource;
    try {
      resource = await microphoneDiagnosticCapture.start();
    } catch (error) {
      if (generation !== diagnosticGeneration) return;
      diagnosticState = failAudioDiagnostic(
        diagnosticState,
        error && error.code ? error.code : 'initialization-failed',
        Date.now(),
      );
      renderMicrophoneDiagnostic();
      return;
    }
    if (!resource || generation !== diagnosticGeneration) return;

    const track = resource.stream.getAudioTracks()[0];
    diagnosticState = activateAudioDiagnostic(
      diagnosticState,
      describeEffectiveInput(track, currentAudioDeviceId('inputId')),
    );
    renderMicrophoneDiagnostic();
    diagnosticHealthTimer = setInterval(
      renderMicrophoneDiagnostic,
      AUDIO_DIAGNOSTIC_DEFAULTS.healthTickMs,
    );
    diagnosticAutoStopTimer = setTimeout(
      () => queueDiagnosticTransition(stopMicrophoneDiagnostic),
      AUDIO_DIAGNOSTIC_DEFAULTS.autoStopMs,
    );
  }

  async function stopMicrophoneDiagnostic() {
    if (!diagnosticIsRunning() && !microphoneDiagnosticCapture.active) return;
    diagnosticGeneration += 1;
    clearDiagnosticTimers();
    await microphoneDiagnosticCapture.stop();
    diagnosticState = stopAudioDiagnostic(diagnosticState, Date.now());
    renderMicrophoneDiagnostic();
  }

  async function testSelectedOutput() {
    const button = $('#audio-test-output');
    const status = $('#audio-output-diagnostic-status');
    button.disabled = true;
    status.textContent = 'Preparing selected cue output…';
    status.className = 's-diagnostic-status';
    try {
      if (!(await applyCueOutput())) {
        status.textContent = 'Output test failed: selected sink is unavailable.';
        status.className = 's-diagnostic-status error';
        return;
      }
      await outputDiagnosticTone.start();
      status.textContent = '440 Hz test tone sent to the selected cue output for 500 ms.';
      status.className = 's-diagnostic-status success';
    } catch (error) {
      status.textContent =
        'Output test failed: ' + (error && error.code ? error.code : 'playback-failed');
      status.className = 's-diagnostic-status error';
    } finally {
      button.disabled = false;
    }
  }

  $('#audio-test-input').addEventListener('click', () => {
    queueDiagnosticTransition(
      diagnosticIsRunning() ? stopMicrophoneDiagnostic : startMicrophoneDiagnostic,
    );
  });
  $('#audio-test-output').addEventListener('click', testSelectedOutput);

  async function applyCueOutput() {
    const requestedId = currentAudioDeviceId('outputId');
    if (!availableOutputLabels.has(requestedId)) {
      effectiveOutput = null;
      setDeviceStatus('#audio-output-effective', 'Selected output is unavailable', 'error');
      return false;
    }
    try {
      effectiveOutput = await applyOutputSelection(cuePlayback, requestedId);
      syncAudioDeviceStatus();
      return true;
    } catch (error) {
      effectiveOutput = null;
      setDeviceStatus(
        '#audio-output-effective',
        'Output unavailable: ' + (error && error.code ? error.code : 'selection-failed'),
        'error',
      );
      return false;
    }
  }

  async function refreshAudioDevices() {
    ensureAudioDeviceSettings();
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (error) {
      cue.log('audio device enumeration error: ' + (error && error.message));
    }
    const inputOptions = buildAudioDeviceOptions(
      devices,
      'audioinput',
      settings.audioDevices.inputId,
    );
    const outputOptions = buildAudioDeviceOptions(
      devices,
      'audiooutput',
      settings.audioDevices.outputId,
    );
    availableInputIds = new Set(
      inputOptions.filter((device) => device.available).map((device) => device.id),
    );
    availableOutputLabels = new Map(
      outputOptions.filter((device) => device.available).map((device) => [device.id, device.label]),
    );
    renderDeviceOptions($('#audio-input'), inputOptions, settings.audioDevices.inputId);
    renderDeviceOptions($('#audio-output'), outputOptions, settings.audioDevices.outputId);
    syncAudioDeviceStatus();
    await applyCueOutput();
  }

  async function saveAudioDeviceSelection(key, value) {
    ensureAudioDeviceSettings();
    settings.audioDevices[key] = normalizeAudioDeviceId(value);
    await cue.settingsSet({ audioDevices: settings.audioDevices });
  }

  $('#audio-input').addEventListener('change', async (event) => {
    const restartDiagnostic = diagnosticIsRunning();
    await saveAudioDeviceSelection('inputId', event.target.value);
    effectiveInput = null;
    syncAudioDeviceStatus();
    if (captureActive) {
      await microphoneCapture.stop();
      await startMic();
    }
    if (restartDiagnostic) {
      await queueDiagnosticTransition(async () => {
        await stopMicrophoneDiagnostic();
        await startMicrophoneDiagnostic();
      });
    }
    await refreshAudioDevices();
  });

  $('#audio-output').addEventListener('change', async (event) => {
    await saveAudioDeviceSelection('outputId', event.target.value);
    await refreshAudioDevices();
  });

  navigator.mediaDevices.addEventListener('devicechange', () => {
    refreshAudioDevices();
  });

  // Assist shortcut recorder. The renderer captures a key combination and the
  // main process only saves it after Electron confirms the global registration.
  const shortcutBtn = $('#shortcut-assist');
  const shortcutHint = $('#shortcut-hint');

  function setShortcutHint(message, kind) {
    shortcutHint.textContent = message;
    shortcutHint.classList.toggle('error', kind === 'error');
    shortcutHint.classList.toggle('success', kind === 'success');
  }

  function cancelShortcutRecording() {
    recordingShortcut = false;
    shortcutBtn.classList.remove('recording');
    syncAssistShortcutLabels();
  }

  function keyEventToAccelerator(e) {
    const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift']);
    if (modifierKeys.has(e.key)) return { error: 'Press a modifier together with another key.' };

    const parts = [];
    const primaryDown = cue.platform === 'darwin' ? e.metaKey : e.ctrlKey;
    if (primaryDown) parts.push('CommandOrControl');
    if (cue.platform === 'darwin' && e.ctrlKey) parts.push('Control');
    if (cue.platform !== 'darwin' && e.metaKey) parts.push('Super');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const named = {
      Enter: 'Return',
      ' ': 'Space',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
    };
    const punctuation = {
      '+': 'Plus',
      '-': '-',
      '=': '=',
      ',': ',',
      '.': '.',
      '/': '/',
      ';': ';',
      "'": "'",
      '[': '[',
      ']': ']',
      '\\': '\\',
      '`': '`',
    };
    let key = named[e.key] || punctuation[e.key] || '';
    if (!key && /^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
    if (!key && /^[0-9]$/.test(e.key)) key = e.key;
    if (!key && /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
    if (!key)
      return { error: 'Use a letter, number, function key, arrow, or common navigation key.' };
    if (!parts.length && !/^F/.test(key))
      return { error: 'Include Command/Ctrl, Alt, or Shift in the shortcut.' };
    parts.push(key);
    return { accelerator: parts.join('+') };
  }

  async function applyAssistShortcut(accelerator) {
    const wasRecording = recordingShortcut;
    recordingShortcut = false;
    shortcutBtn.classList.remove('recording');
    shortcutBtn.textContent = 'Saving…';
    let result;
    try {
      result = await cue.shortcutAssistSet(accelerator);
    } catch (_) {
      result = { ok: false, error: 'cue could not update the shortcut. Please try again.' };
    }
    if (!result.ok) {
      setShortcutHint(result.error, 'error');
      recordingShortcut = wasRecording;
      shortcutBtn.classList.toggle('recording', recordingShortcut);
      if (recordingShortcut) shortcutBtn.textContent = 'Press keys…';
      else syncAssistShortcutLabels();
      return;
    }
    assistShortcut = result.accelerator;
    if (!settings.shortcuts) settings.shortcuts = {};
    settings.shortcuts.assist = assistShortcut;
    cancelShortcutRecording();
    setShortcutHint('Assist shortcut updated.', 'success');
  }

  shortcutBtn.addEventListener('click', () => {
    recordingShortcut = true;
    shortcutBtn.classList.add('recording');
    shortcutBtn.textContent = 'Press keys…';
    setShortcutHint('Press Escape to cancel.', '');
  });

  $('#shortcut-reset').addEventListener('click', () =>
    applyAssistShortcut(DEFAULT_ASSIST_SHORTCUT),
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!recordingShortcut) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        cancelShortcutRecording();
        setShortcutHint('Shortcut change cancelled.', '');
        return;
      }
      const captured = keyEventToAccelerator(e);
      if (captured.error) {
        setShortcutHint(captured.error, 'error');
        return;
      }
      applyAssistShortcut(captured.accelerator);
    },
    true,
  );

  // ---- example conversation (matches the reference screenshot) ------------
  function showExample() {
    clearMessages();
    addUserBubble('What should I say?');
    const ai = document.createElement('div');
    ai.className = 'ai-text';
    ai.textContent =
      '“A discounted cash flow model values a company by projecting future free cash flows and discounting them to present value using the weighted average cost of capital.”';
    messages.appendChild(ai);
  }

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closeSettings();
    if (isCmdOrCtrl(e)) {
      if (e.key === ',') {
        e.preventDefault();
        openSettings();
      }
    }
  });

  // UI Zoom buttons (text only)
  let currentZoom = 1;
  function updateZoom(delta) {
    currentZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
    document.documentElement.style.setProperty('--text-zoom', currentZoom);
  }
  $('#zoom-in-btn').addEventListener('click', () => updateZoom(0.1));
  $('#zoom-out-btn').addEventListener('click', () => updateZoom(-0.1));

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) {
    if (v !== ignoring) {
      ignoring = v;
      cue.setIgnoreMouse(v);
    }
  }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(
      el &&
      el.closest &&
      el.closest('#toolbar, #panel-wrap, #settings-scrim, #onboard-scrim')
    );
    setIgnore(!overUI);
  });
  setIgnore(true); // start fully click-through; hovering the panel re-enables it

  // ---- onboarding / first-run tutorial -----------------------------------
  const obScrim = $('#onboard-scrim');
  const OB_STEPS = [
    {
      icon: '👋',
      title: 'Welcome to cue',
      body: 'cue is a private AI copilot that floats over your screen. It can <strong>see your screen</strong>, <strong>hear your meetings</strong>, and help you answer questions or solve coding problems — while staying hidden from most screen shares.<br><br>This quick guide gets you running in about a minute.',
    },
    ...(cue.platform === 'darwin'
      ? [
          {
            icon: '🔐',
            title: 'Allow cue to see & hear',
            body: 'cue needs two macOS permissions. Click each button, turn <strong>cue</strong> ON in the window that opens, then come back here.<ul><li><strong>Microphone</strong> — to hear you</li><li><strong>Screen Recording</strong> — to see your screen and hear meeting audio</li></ul>',
            buttons: [
              {
                label: 'Open Microphone settings',
                action: () =>
                  cue.openPane(
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
                  ),
              },
              {
                label: 'Open Screen Recording settings',
                action: () =>
                  cue.openPane(
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
                  ),
              },
            ],
          },
        ]
      : []),
    {
      icon: '🔑',
      title: 'Connect an AI provider',
      body: 'cue uses <strong>your own</strong> API key — pick <span class="hl">OpenAI</span>, <span class="hl">Anthropic</span>, <span class="hl">Google Gemini</span>, or <span class="hl">Nvidia</span>. Get a key from your provider, then paste it into cue\'s Settings.<br><br><strong>Tip:</strong> the listening features need speech-to-text access (an OpenAI key with Whisper, or a Gemini key). A chat-only key still powers screen &amp; coding help.',
      buttons: [
        {
          label: 'Open cue Settings',
          action: () => {
            finishOnboard();
            openSettings();
          },
        },
      ],
    },
    {
      icon: '🫥',
      title: 'Stay hidden in Zoom',
      body:
        cue.platform === 'darwin'
          ? 'cue is hidden from most screen shares automatically (Google Meet, Teams, QuickTime — nothing to do). <strong>Zoom needs one setting:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong><br><br>Avoid “<strong>without</strong> window filtering” — that mode reveals cue.'
          : 'cue is hidden from screen shares automatically. <strong>For Zoom:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong>',
    },
    {
      icon: '✨',
      title: 'You’re all set',
      body: () =>
        `How to use cue:<ul><li>${shortcutKeycapsHtml(assistShortcut, 'kbd')} — <strong>Assist</strong> with whatever's on screen or being said</li><li><span class="kbd">${cmdKey}</span> <span class="kbd">H</span> — solve a coding problem on screen</li><li>Click <strong>▢</strong> in the top bar to start listening to a meeting</li><li>Type a question and press <span class="kbd">↵</span></li></ul>Reopen this guide anytime by clicking the <strong>cue logo</strong>. Change Assist's shortcut in <strong>Settings</strong>. Quit with <span class="kbd">${cmdKey}</span><span class="kbd">⇧</span><span class="kbd">X</span>.`,
    },
  ];
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    $('#ob-icon').textContent = step.icon;
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = typeof step.body === 'function' ? step.body() : step.body;
    const btns = $('#ob-buttons');
    btns.innerHTML = '';
    (step.buttons || []).forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.addEventListener('click', b.action);
      btns.appendChild(el);
    });
    const dots = $('#ob-dots');
    dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => {
      const d = document.createElement('span');
      if (i === obIndex) d.className = 'on';
      dots.appendChild(d);
    });
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? 'Done' : 'Next';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
  }
  function showOnboard() {
    obIndex = 0;
    renderOnboard();
    obScrim.classList.remove('hidden');
    setIgnore(false);
  }
  async function finishOnboard() {
    obScrim.classList.add('hidden');
    if (settings && !settings.onboarded) {
      settings.onboarded = true;
      await cue.settingsSet({ onboarded: true });
    }
  }
  $('#ob-next').addEventListener('click', () => {
    if (obIndex === OB_STEPS.length - 1) finishOnboard();
    else {
      obIndex++;
      renderOnboard();
    }
  });
  $('#ob-back').addEventListener('click', () => {
    if (obIndex > 0) {
      obIndex--;
      renderOnboard();
    }
  });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', showOnboard);

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    settings = await cue.settingsGet();
    ensureAudioDeviceSettings();
    assistShortcut = (settings.shortcuts && settings.shortcuts.assist) || DEFAULT_ASSIST_SHORTCUT;
    syncAssistShortcutLabels();
    smartBtn.classList.toggle('on', !!settings.smart);
    showExample();
    syncPlaceholder();
    const st = await cue.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    $('#stop-btn').classList.toggle('active', st.active);
    if (!settings.onboarded) showOnboard();
    await refreshAudioDevices();
    renderMicrophoneDiagnostic();
  })();
})();
