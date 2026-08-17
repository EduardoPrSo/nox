export const EKO_CLIENT_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>NOX Eko</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100svh; background: radial-gradient(circle at top, #173330, #080d11 58%); color: #f4f8f7; }
      main { width: min(94vw, 920px); margin: 28px auto; padding: 24px; border: 1px solid #29433f; border-radius: 22px; background: #0b1415e8; box-shadow: 0 24px 70px #0008; }
      h1 { margin: 0; letter-spacing: .18em; font-size: 1.25rem; }
      h2 { margin: 0 0 12px; font-size: .9rem; color: #a8bdb8; text-transform: uppercase; letter-spacing: .08em; }
      .subtitle, small { color: #91a39f; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 20px 0; }
      .card { padding: 16px; border: 1px solid #29413e; border-radius: 14px; background: #0d1b1b; }
      label { display: block; color: #b8c9c5; font-size: .8rem; margin-bottom: 7px; }
      input { width: 100%; border: 1px solid #36504c; border-radius: 10px; padding: 11px; color: white; background: #081112; }
      button { border: 1px solid #3b5b55; border-radius: 11px; padding: 11px 15px; color: white; background: #17352f; cursor: pointer; font-weight: 700; }
      button:hover { filter: brightness(1.12); }
      button:disabled { opacity: .45; cursor: wait; }
      .controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      #toggle.on { background: #9a3548; border-color: #c95166; }
      #active { background: #3b4fb0; border-color: #6377e7; touch-action: none; }
      .state { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #67716f; }
      .ambient .dot { background: #4ee1ac; box-shadow: 0 0 14px #4ee1ac; }
      .active .dot { background: #7589ff; box-shadow: 0 0 14px #7589ff; }
      meter { width: 100%; height: 18px; }
      pre { min-height: 80px; max-height: 220px; overflow: auto; white-space: pre-wrap; color: #c9d7d4; font: 12px/1.5 ui-monospace, monospace; }
      .value { color: #ecf6f3; line-height: 1.45; overflow-wrap: anywhere; }
      audio { width: 100%; margin-top: 10px; }
      .warning { color: #efc482; }
    </style>
  </head>
  <body>
    <main>
      <h1>NOX · EKO</h1>
      <p class="subtitle">Bancada de escuta ambiental. AMBIENT memoriza seletivamente e nunca responde.</p>
      <label for="token">Token de acesso</label>
      <input id="token" type="password" autocomplete="off" placeholder="NOX_API_TOKEN" />
      <div class="controls">
        <button id="toggle" type="button">LIGAR EKO</button>
        <button id="active" type="button">SEGURE PARA FALAR COM O NOX</button>
      </div>
      <div class="grid">
        <section class="card">
          <h2>Estado</h2>
          <div id="state" class="state"><span class="dot"></span><span>OFF</span></div>
          <p id="microphone" class="value">Microfone ambiental desligado</p>
          <p id="wake" class="warning">Wake word: fallback explícito por botão</p>
        </section>
        <section class="card">
          <h2>VAD local</h2>
          <meter id="level" min="0" max="0.12" value="0"></meter>
          <p id="vad" class="value">Inativo</p>
          <small id="buffer">Ring buffer: 0 s</small>
        </section>
        <section class="card">
          <h2>Último segmento</h2>
          <p id="transcript" class="value">—</p>
          <p id="decision" class="value">—</p>
          <p id="memory" class="value">—</p>
        </section>
        <section class="card">
          <h2>Solicitação ACTIVE</h2>
          <p id="answer" class="value">—</p>
          <audio id="audio" controls hidden></audio>
          <div id="confirmation" class="controls" hidden>
            <button id="reject" type="button">Cancelar</button>
            <button id="approve" type="button">Confirmar</button>
          </div>
        </section>
      </div>
      <section class="card">
        <h2>Eventos</h2>
        <pre id="events"></pre>
      </section>
      <small>Áudio bruto e ring buffer ficam somente na RAM desta página. Transcrições ambientais expiram no Core. Abas em background, tela bloqueada e suspensão mobile podem interromper a captura.</small>
    </main>
    <script>
      const nodes = Object.fromEntries(['token','toggle','active','state','microphone','wake','level','vad','buffer','transcript','decision','memory','answer','audio','confirmation','reject','approve','events'].map(function (id) { return [id, document.getElementById(id)]; }));
      nodes.token.value = sessionStorage.getItem('nox-token') || '';
      let config = { speechThreshold: .025, minimumSpeechMs: 600, silenceTimeoutMs: 900, maximumSegmentMs: 30000, ringBufferSeconds: 45 };
      let ambient = false, activeMode = false, stream, context, analyser, recorder, segmentChunks = [], speechStartedAt, speechActiveMs = 0, silenceStartedAt, loopTimer, activeRecorder, activeChunks = [], activeStartedAt, pendingConfirmationId, audioUrl;
      const ring = [];

      function authHeaders(json) {
        const token = nodes.token.value.trim();
        if (!token) throw new Error('Informe o token de acesso.');
        sessionStorage.setItem('nox-token', token);
        const headers = { Authorization: 'Bearer ' + token };
        if (json) headers['Content-Type'] = 'application/json';
        const sessionId = sessionStorage.getItem('nox-session-id');
        if (sessionId) headers['x-session-id'] = sessionId;
        return headers;
      }

      function captureSession(response) {
        const sessionId = response.headers.get('x-session-id');
        if (sessionId) sessionStorage.setItem('nox-session-id', sessionId);
      }

      function log(message) {
        nodes.events.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + message + '\n' + nodes.events.textContent.slice(0, 5000);
      }

      function showState(state) {
        nodes.state.className = 'state ' + (state === 'AMBIENT' ? 'ambient' : state === 'ACTIVE' ? 'active' : '');
        nodes.state.lastElementChild.textContent = state;
      }

      function mimeType() {
        return ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(function (type) { return MediaRecorder.isTypeSupported(type); }) || '';
      }

      async function setCoreState(state) {
        const response = await fetch('/v1/eko/state', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ state: state }) });
        captureSession(response);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao alterar o Eko');
        return body.state;
      }

      async function loadConfig() {
        const response = await fetch('/v1/eko/config', { headers: authHeaders(false) });
        captureSession(response);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao carregar configuração');
        config = body;
      }

      async function startAmbient() {
        nodes.toggle.disabled = true;
        try {
          await loadConfig();
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          context = new AudioContext();
          const source = context.createMediaStreamSource(stream);
          analyser = context.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          await setCoreState('AMBIENT');
          ambient = true;
          nodes.toggle.textContent = 'DESLIGAR EKO';
          nodes.toggle.classList.add('on');
          nodes.microphone.textContent = 'Microfone ambiental ativo';
          showState('AMBIENT');
          log('Eko entrou em AMBIENT');
          loopTimer = setInterval(vadFrame, 50);
        } catch (error) {
          await stopAmbient(false);
          log(error instanceof Error ? error.message : 'Falha ao iniciar');
        } finally { nodes.toggle.disabled = false; }
      }

      async function stopAmbient(updateCore) {
        ambient = false;
        clearInterval(loopTimer);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        recorder = undefined;
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        if (context) await context.close().catch(function () {});
        stream = context = analyser = undefined;
        ring.length = 0;
        speechStartedAt = silenceStartedAt = undefined;
        nodes.toggle.textContent = 'LIGAR EKO';
        nodes.toggle.classList.remove('on');
        nodes.microphone.textContent = 'Microfone ambiental desligado';
        nodes.vad.textContent = 'Inativo';
        nodes.buffer.textContent = 'Ring buffer: 0 s';
        nodes.level.value = 0;
        showState('OFF');
        if (updateCore !== false) {
          try { await setCoreState('OFF'); log('Eko entrou em OFF'); } catch (error) { log(error instanceof Error ? error.message : 'Falha ao desligar'); }
        }
      }

      function vadFrame() {
        if (!ambient || !analyser || activeMode) return;
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let power = 0;
        for (let i = 0; i < samples.length; i++) power += samples[i] * samples[i];
        const rms = Math.sqrt(power / samples.length);
        const now = performance.now();
        nodes.level.value = Math.min(.12, rms);
        ring.push({ at: now, samples: samples });
        while (ring.length && ring[0].at < now - config.ringBufferSeconds * 1000) ring.shift();
        nodes.buffer.textContent = 'Ring buffer: ' + Math.min(config.ringBufferSeconds, ring.length * .05).toFixed(1) + ' s';
        const speaking = rms >= config.speechThreshold;
        const startedThisFrame = speechStartedAt === undefined && speaking;
        if (startedThisFrame) startSegment(now);
        if (speechStartedAt === undefined) { nodes.vad.textContent = 'Silêncio · nível ' + rms.toFixed(4); return; }
        if (speaking) {
          if (!startedThisFrame) speechActiveMs += 50;
          silenceStartedAt = undefined;
        }
        else if (silenceStartedAt === undefined) silenceStartedAt = now;
        const duration = now - speechStartedAt;
        nodes.vad.textContent = 'Fala detectada · ' + (duration / 1000).toFixed(1) + ' s';
        if (duration >= config.maximumSegmentMs || (silenceStartedAt !== undefined && now - silenceStartedAt >= config.silenceTimeoutMs)) finishSegment(duration);
      }

      function startSegment(now) {
        const type = mimeType();
        if (!type || !stream) { log('MediaRecorder não suportado'); return; }
        segmentChunks = [];
        recorder = new MediaRecorder(stream, { mimeType: type });
        recorder.ondataavailable = function (event) { if (event.data.size) segmentChunks.push(event.data); };
        recorder.start();
        speechStartedAt = now;
        speechActiveMs = 50;
        silenceStartedAt = undefined;
        log('VAD iniciou segmento');
      }

      function finishSegment(durationMs) {
        const current = recorder;
        const activeSpeechMs = speechActiveMs;
        recorder = undefined;
        speechStartedAt = silenceStartedAt = undefined;
        speechActiveMs = 0;
        if (!current || current.state === 'inactive') return;
        current.onstop = function () {
          if (activeSpeechMs < config.minimumSpeechMs) { log('Segmento descartado: fala curta demais'); return; }
          const blob = new Blob(segmentChunks, { type: current.mimeType });
          sendAmbientSegment(blob, Math.round(durationMs));
        };
        current.stop();
      }

      async function sendAmbientSegment(blob, durationMs) {
        const form = new FormData();
        form.append('durationMs', String(durationMs));
        form.append('audio', blob, 'eko.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
        log('Enviando segmento de ' + (durationMs / 1000).toFixed(1) + ' s');
        try {
          const response = await fetch('/v1/eko/segments', { method: 'POST', headers: authHeaders(false), body: form });
          captureSession(response);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error + (body.limit ? ': ' + body.limit : ''));
          nodes.transcript.textContent = body.transcript ? body.transcript.text : '(vazio)';
          nodes.decision.textContent = body.decision + ' · ' + body.reason;
          nodes.memory.textContent = body.memory ? body.memory.type + ': ' + body.memory.content + (body.deduplicated ? ' (reforçada)' : '') : 'Nenhuma memória criada';
          log('Segmento: ' + body.decision + ' (' + body.reason + ')');
        } catch (error) { log(error instanceof Error ? error.message : 'Falha no segmento'); }
      }

      async function startActive() {
        if (activeRecorder) return;
        try {
          activeMode = true;
          if (recorder && recorder.state !== 'inactive') {
            recorder.ondataavailable = null;
            recorder.onstop = null;
            recorder.stop();
            recorder = undefined;
            speechStartedAt = silenceStartedAt = undefined;
            speechActiveMs = 0;
            log('Segmento AMBIENT cancelado pela ativação explícita');
          }
          const activeStream = stream || await navigator.mediaDevices.getUserMedia({ audio: true });
          const type = mimeType();
          if (!type) throw new Error('MediaRecorder não suportado');
          activeChunks = [];
          activeRecorder = new MediaRecorder(activeStream, { mimeType: type });
          activeRecorder.ondataavailable = function (event) { if (event.data.size) activeChunks.push(event.data); };
          activeRecorder.start();
          activeStartedAt = performance.now();
          showState('ACTIVE');
          nodes.wake.textContent = 'Ativação explícita: botão/push-to-talk';
          log('ACTIVE iniciado explicitamente');
        } catch (error) { activeMode = false; log(error instanceof Error ? error.message : 'Falha no ACTIVE'); }
      }

      function stopActive() {
        const current = activeRecorder;
        activeRecorder = undefined;
        if (!current || current.state === 'inactive') return;
        current.onstop = function () {
          const blob = new Blob(activeChunks, { type: current.mimeType });
          sendActive(blob);
          if (!ambient) current.stream.getTracks().forEach(function (track) { track.stop(); });
        };
        current.stop();
        activeMode = false;
        showState(ambient ? 'AMBIENT' : 'OFF');
      }

      async function sendActive(blob) {
        const form = new FormData();
        const conversationId = sessionStorage.getItem('nox-conversation-id');
        if (conversationId) form.append('conversationId', conversationId);
        form.append('audio', blob, 'active.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
        try {
          const response = await fetch('/v1/voice', { method: 'POST', headers: authHeaders(false), body: form });
          captureSession(response);
          const body = await response.json();
          if (body.conversationId) sessionStorage.setItem('nox-conversation-id', body.conversationId);
          if (!response.ok && !body.assistantText) throw new Error(body.error || 'Falha no ACTIVE');
          showActiveResult(body);
          log('ACTIVE respondeu em ' + Math.round(performance.now() - activeStartedAt) + ' ms');
        } catch (error) { log(error instanceof Error ? error.message : 'Falha no ACTIVE'); }
      }

      function showActiveResult(body) {
        nodes.answer.textContent = body.assistantText || body.content || body.description || '—';
        pendingConfirmationId = body.confirmationId;
        nodes.confirmation.hidden = !pendingConfirmationId;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        if (body.audio && body.audio.data) {
          const raw = atob(body.audio.data), bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          audioUrl = URL.createObjectURL(new Blob([bytes], { type: body.audio.mimeType }));
          nodes.audio.src = audioUrl;
          nodes.audio.hidden = false;
          nodes.audio.play().catch(function () {});
        }
      }

      async function confirm(approved) {
        if (!pendingConfirmationId) return;
        const response = await fetch('/v1/confirmations/' + pendingConfirmationId, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ approved: approved, interactionMode: 'voice' }) });
        captureSession(response);
        const body = await response.json();
        if (!response.ok) { log(body.error || 'Falha na confirmação'); return; }
        pendingConfirmationId = undefined;
        nodes.confirmation.hidden = true;
        showActiveResult(body);
      }

      nodes.toggle.addEventListener('click', function () { ambient ? stopAmbient(true) : startAmbient(); });
      nodes.active.addEventListener('pointerdown', function (event) { event.preventDefault(); nodes.active.setPointerCapture(event.pointerId); startActive(); });
      nodes.active.addEventListener('pointerup', function (event) { event.preventDefault(); stopActive(); });
      nodes.active.addEventListener('pointercancel', stopActive);
      nodes.approve.addEventListener('click', function () { confirm(true); });
      nodes.reject.addEventListener('click', function () { confirm(false); });
      window.addEventListener('pagehide', function () { if (ambient) { fetch('/v1/eko/state', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ state: 'OFF' }), keepalive: true }).catch(function () {}); } });
    </script>
  </body>
</html>`;
