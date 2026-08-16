export const VOICE_CLIENT_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>NOX Voice</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: radial-gradient(circle at top, #18223a, #080b12 62%); color: #f5f7fb; }
      main { width: min(92vw, 560px); padding: 24px; border: 1px solid #28334b; border-radius: 24px; background: rgba(11, 15, 25, .88); box-shadow: 0 24px 70px #0008; backdrop-filter: blur(14px); }
      h1 { margin: 0; letter-spacing: .18em; font-size: 1.2rem; }
      .subtitle { color: #9ca8bd; margin: 8px 0 22px; }
      label { display: block; color: #bdc6d7; font-size: .82rem; margin-bottom: 8px; }
      input { width: 100%; border: 1px solid #34415c; border-radius: 12px; background: #0c1220; color: #fff; padding: 12px; }
      #record { display: grid; place-items: center; width: 150px; height: 150px; margin: 28px auto 18px; border: 0; border-radius: 50%; color: white; background: linear-gradient(145deg, #6577ff, #3d48bb); box-shadow: 0 12px 36px #5365ff55; font: inherit; font-weight: 750; cursor: pointer; touch-action: none; user-select: none; transition: transform .15s, filter .15s; }
      #record:hover { filter: brightness(1.08); }
      #record.recording { transform: scale(.94); background: linear-gradient(145deg, #ff657d, #bc334e); animation: pulse 1.2s infinite; }
      #record:disabled { opacity: .45; cursor: wait; }
      @keyframes pulse { 50% { box-shadow: 0 12px 48px #ff536b88; } }
      #status { min-height: 24px; text-align: center; color: #aab5ca; }
      .result { display: none; margin-top: 22px; padding-top: 18px; border-top: 1px solid #273149; }
      .result.visible { display: block; }
      .label { margin-top: 14px; color: #8290a9; font-size: .75rem; text-transform: uppercase; letter-spacing: .1em; }
      p { white-space: pre-wrap; line-height: 1.5; }
      audio { width: 100%; margin-top: 12px; }
      .actions { display: none; gap: 10px; margin-top: 16px; }
      .actions.visible { display: flex; }
      .actions button { flex: 1; border: 1px solid #3c4a68; border-radius: 10px; padding: 11px; background: #172036; color: #fff; cursor: pointer; }
      .actions .approve { background: #315f4b; border-color: #4e8b70; }
      small { display: block; margin-top: 20px; color: #6f7d95; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main>
      <h1>NOX VOICE</h1>
      <p class="subtitle">Segure para falar. Solte para enviar.</p>
      <label for="token">Token de acesso</label>
      <input id="token" type="password" autocomplete="off" placeholder="NOX_API_TOKEN" />
      <button id="record" type="button">SEGURE<br />PARA FALAR</button>
      <div id="status" role="status">Pronto</div>
      <section id="result" class="result" aria-live="polite">
        <div class="label">Você disse</div>
        <p id="transcription"></p>
        <div class="label">NOX</div>
        <p id="answer"></p>
        <audio id="audio" controls></audio>
        <div id="actions" class="actions">
          <button id="reject" type="button">Cancelar</button>
          <button id="approve" class="approve" type="button">Confirmar</button>
        </div>
        <div class="label">Latência</div>
        <p id="latency"></p>
      </section>
      <small>O áudio bruto é enviado somente para processamento e não é salvo pelo NOX. O token fica apenas nesta sessão do navegador.</small>
    </main>
    <script>
      const tokenInput = document.querySelector('#token');
      const recordButton = document.querySelector('#record');
      const statusNode = document.querySelector('#status');
      const resultNode = document.querySelector('#result');
      const transcriptionNode = document.querySelector('#transcription');
      const answerNode = document.querySelector('#answer');
      const audioNode = document.querySelector('#audio');
      const latencyNode = document.querySelector('#latency');
      const actionsNode = document.querySelector('#actions');
      const approveButton = document.querySelector('#approve');
      const rejectButton = document.querySelector('#reject');
      tokenInput.value = sessionStorage.getItem('nox-token') || '';
      let recorder;
      let stream;
      let chunks = [];
      let stopTimer;
      let pendingConfirmationId;
      let audioUrl;
      let pressActive = false;
      let starting = false;

      function supportedMimeType() {
        const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
        return candidates.find(function (type) { return MediaRecorder.isTypeSupported(type); }) || '';
      }

      async function startRecording(event) {
        if (recorder || starting || recordButton.disabled) return;
        const token = tokenInput.value.trim();
        if (!token) { statusNode.textContent = 'Informe o token de acesso.'; tokenInput.focus(); return; }
        sessionStorage.setItem('nox-token', token);
        starting = true;
        try {
          if (event && event.pointerId !== undefined) recordButton.setPointerCapture(event.pointerId);
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!pressActive) { cleanupRecorder(); return; }
          const mimeType = supportedMimeType();
          if (!mimeType) throw new Error('Formato de gravação não suportado.');
          recorder = new MediaRecorder(stream, { mimeType: mimeType });
          chunks = [];
          recorder.ondataavailable = function (item) { if (item.data.size) chunks.push(item.data); };
          recorder.onstop = sendRecording;
          recorder.start();
          recordButton.classList.add('recording');
          statusNode.textContent = 'Ouvindo…';
          stopTimer = setTimeout(stopRecording, 60000);
        } catch (error) {
          cleanupRecorder();
          statusNode.textContent = error instanceof Error ? error.message : 'Não consegui acessar o microfone.';
        } finally {
          starting = false;
        }
      }

      function stopRecording() {
        pressActive = false;
        if (!recorder || recorder.state === 'inactive') return;
        clearTimeout(stopTimer);
        recorder.stop();
        recordButton.classList.remove('recording');
        recordButton.disabled = true;
        statusNode.textContent = 'Pensando…';
      }

      function cleanupRecorder() {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        stream = undefined;
        recorder = undefined;
        recordButton.classList.remove('recording');
        recordButton.disabled = false;
      }

      async function sendRecording() {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        cleanupRecorder();
        const form = new FormData();
        const conversationId = sessionStorage.getItem('nox-conversation-id');
        if (conversationId) form.append('conversationId', conversationId);
        form.append('audio', blob, 'recording.' + (mimeType.includes('mp4') ? 'm4a' : 'webm'));
        const headers = { Authorization: 'Bearer ' + tokenInput.value.trim() };
        const sessionId = sessionStorage.getItem('nox-session-id');
        if (sessionId) headers['x-session-id'] = sessionId;
        try {
          const response = await fetch('/v1/voice', { method: 'POST', headers: headers, body: form });
          const body = await response.json();
          const returnedSession = response.headers.get('x-session-id');
          if (returnedSession) sessionStorage.setItem('nox-session-id', returnedSession);
          if (body.conversationId) sessionStorage.setItem('nox-conversation-id', body.conversationId);
          if (!response.ok && !body.assistantText) throw new Error(body.error || 'Falha na chamada');
          showResult(body);
          statusNode.textContent = response.ok ? 'Pronto' : 'Resposta recebida sem áudio.';
        } catch (error) {
          statusNode.textContent = error instanceof Error ? error.message : 'Falha ao processar a voz.';
        } finally {
          recordButton.disabled = false;
        }
      }

      function showResult(body) {
        transcriptionNode.textContent = body.transcription || '';
        answerNode.textContent = body.assistantText || '';
        const latency = body.latencyMs || {};
        latencyNode.textContent = 'STT ' + (latency.stt || 0) + ' ms · agente ' + (latency.agent || 0) + ' ms · TTS ' + (latency.tts || 0) + ' ms · total ' + (latency.total || 0) + ' ms';
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        if (body.audio && body.audio.data) {
          const raw = atob(body.audio.data);
          const bytes = new Uint8Array(raw.length);
          for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
          audioUrl = URL.createObjectURL(new Blob([bytes], { type: body.audio.mimeType }));
          audioNode.src = audioUrl;
          audioNode.hidden = false;
          audioNode.play().catch(function () {});
        } else {
          audioNode.removeAttribute('src');
          audioNode.hidden = true;
        }
        pendingConfirmationId = body.confirmationId;
        actionsNode.classList.toggle('visible', Boolean(pendingConfirmationId));
        resultNode.classList.add('visible');
      }

      async function resolveConfirmation(approved) {
        if (!pendingConfirmationId) return;
        actionsNode.classList.remove('visible');
        statusNode.textContent = approved ? 'Confirmando…' : 'Cancelando…';
        const headers = { Authorization: 'Bearer ' + tokenInput.value.trim(), 'Content-Type': 'application/json' };
        const sessionId = sessionStorage.getItem('nox-session-id');
        if (sessionId) headers['x-session-id'] = sessionId;
        try {
          const response = await fetch('/v1/confirmations/' + pendingConfirmationId, {
            method: 'POST', headers: headers, body: JSON.stringify({ approved: approved, interactionMode: 'voice' })
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.message || body.error || 'Falha na confirmação');
          body.assistantText = body.assistantText || body.content;
          body.transcription = '';
          showResult(body);
          pendingConfirmationId = undefined;
          statusNode.textContent = 'Pronto';
        } catch (error) {
          statusNode.textContent = error instanceof Error ? error.message : 'Falha na confirmação.';
        }
      }

      recordButton.addEventListener('pointerdown', function (event) { event.preventDefault(); pressActive = true; startRecording(event); });
      recordButton.addEventListener('pointerup', function (event) { event.preventDefault(); stopRecording(); });
      recordButton.addEventListener('pointercancel', stopRecording);
      recordButton.addEventListener('keydown', function (event) { if (event.code === 'Space' && !event.repeat) { event.preventDefault(); pressActive = true; startRecording(); } });
      recordButton.addEventListener('keyup', function (event) { if (event.code === 'Space') { event.preventDefault(); stopRecording(); } });
      approveButton.addEventListener('click', function () { resolveConfirmation(true); });
      rejectButton.addEventListener('click', function () { resolveConfirmation(false); });
    </script>
  </body>
</html>`;
