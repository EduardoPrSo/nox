# Protocolo futuro do pendant

O ESP32-S3 será um cliente não confiável e nunca armazenará chaves de provedores de IA. Ele autenticará no NOX Core com credencial revogável própria do dispositivo, sobre TLS.

Proposta inicial, ainda não implementada:

- HTTPS para registro, configuração e uploads ocasionais.
- WebSocket autenticado para sessão interativa e eventos.
- Frames binários para áudio/imagem; envelopes JSON versionados para controle.
- Campos comuns: `protocolVersion`, `deviceId`, `sessionId`, `messageId`, `sequence`, `timestamp`, `type`.
- Tipos previstos: `session.start`, `audio.chunk`, `image.capture`, `input.button`, `assistant.text`, `assistant.audio`, `status`, `error`.
- Limites de tamanho, sequência monotônica, deduplicação por `messageId`, heartbeat e retomada segura.

O Voice MVP já oferece um caminho simples para protótipos: o dispositivo captura WAV/WebM/MP3/M4A, envia multipart autenticado para `/v1/voice` e reproduz o MP3 base64 retornado. Ele não precisa conhecer LLM, tools nem chaves de providers. Esse transporte bufferizado não é o protocolo final; um futuro adapter de streaming poderá alimentar as mesmas portas STT/TTS e o mesmo `AgentRuntime`.

Confirmações EXTERNAL devem ser apresentadas ao usuário e aprovadas explicitamente; uma resposta genérica de áudio não deve ser interpretada como autorização sem estar vinculada ao ID pendente.
