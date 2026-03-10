"""
Buddy Voice Listener v5 - Hibrido: Vosk + faster-whisper
- Vosk (grammar restrita): detecta wake word "Buddy" rapido e leve
- faster-whisper (modelo base): transcreve comandos com alta precisao
- Auto-instala dependencias na primeira execucao
"""
import subprocess, sys, os, json, queue, time, threading, tempfile, wave, struct

def install_if_missing(package, pip_name=None):
    try:
        __import__(package)
    except ImportError:
        name = pip_name or package
        print(json.dumps({"type": "status", "text": f"Instalando {name}..."}), flush=True)
        subprocess.check_call([sys.executable, "-m", "pip", "install", name, "--quiet"])

install_if_missing("vosk")
install_if_missing("sounddevice")
install_if_missing("faster_whisper", "faster-whisper")

import vosk
import sounddevice as sd
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model")
WAKE_WORDS = ["babe", "body", "bode", "badi", "bud", "budi", "bude", "bad"]
ACTIVATE_WORDS = ["ativa", "ativar", "ligar", "liga"]
DEACTIVATE_WORDS = ["tchau", "desativa", "desativar", "desligar", "desliga", "fechar", "fecha"]

is_paused = False
force_record_flag = False

def send(msg_type, text=""):
    print(json.dumps({"type": msg_type, "text": text}), flush=True)

def has_wake(text):
    return any(w in text.lower() for w in WAKE_WORDS)

def has_activate(text):
    lower = text.lower()
    return any(a in lower for a in ACTIVATE_WORDS) and has_wake(text)

def has_deactivate(text):
    lower = text.lower()
    return any(d in lower for d in DEACTIVATE_WORDS)

def save_audio_to_wav(audio_data, sample_rate, filepath):
    """Salva raw int16 audio como WAV"""
    with wave.open(filepath, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(audio_data)

def transcribe_with_whisper(whisper_model, audio_bytes, sample_rate):
    """Transcreve audio usando faster-whisper"""
    # Salva em arquivo temp WAV
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    try:
        save_audio_to_wav(audio_bytes, sample_rate, tmp.name)
        tmp.close()
        segments, info = whisper_model.transcribe(
            tmp.name, language="pt", beam_size=3,
            vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500)
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text
    finally:
        try: os.unlink(tmp.name)
        except: pass

def main():
    global force_record_flag
    if not os.path.exists(MODEL_DIR):
        send("error", "Modelo Vosk nao encontrado: " + MODEL_DIR)
        sys.exit(1)

    # Carrega Vosk (wake word)
    vosk.SetLogLevel(-1)
    send("status", "Carregando modelo de voz (Vosk)...")
    vosk_model = vosk.Model(MODEL_DIR)
    WAKE_GRAMMAR = '["budi", "bude", "bud", "body", "bode", "badi", "bad", "babe", "ativa", "liga", "ativar", "ligar", "[unk]"]'
    wake_rec = vosk.KaldiRecognizer(vosk_model, SAMPLE_RATE, WAKE_GRAMMAR)

    # Carrega faster-whisper (comandos)
    send("status", "Carregando modelo Whisper (primeira vez pode demorar)...")
    whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    send("status", "Modelos carregados!")
    send("ready", "")

    q = queue.Queue()
    # Estados: "passive" | "recording" | "conversation"
    state = "passive"
    recording_buffer = bytearray()
    recording_start = 0
    RECORD_MAX = 30  # Max segundos gravando comando (antes era 5)
    SILENCE_TIMEOUT = 2.0  # Segundos de silencio para parar gravacao no modo comando (antes era 1.5)
    CONVERSATION_SILENCE = 2.5  # Segundos de silencio para parar no modo conversa

    def audio_cb(indata, frames, time_info, status):
        if not is_paused:
            q.put(bytes(indata))

    def has_sound(data, threshold=800):
        """Checa se o audio tem pico acima do threshold (voz real, nao ruido)"""
        peak = 0
        for i in range(0, len(data) - 1, 2):
            sample = abs(struct.unpack_from('<h', data, i)[0])
            if sample > peak:
                peak = sample
        return peak > threshold

    last_sound_time = time.time()

    # Verifica se tem microfone disponível
    try:
        devices = sd.query_devices()
        input_devices = [d for d in devices if d['max_input_channels'] > 0]
        if not input_devices:
            send("error", "Nenhum microfone encontrado! Conecte um microfone e reinicie.")
            sys.exit(1)
        default_input = sd.query_devices(kind='input')
        send("status", f"Microfone: {default_input['name']}")
    except Exception as e:
        send("error", f"Erro ao detectar microfone: {e}")
        sys.exit(1)

    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE, blocksize=2000,
            dtype="int16", channels=1, callback=audio_cb
        ):
            send("listening", "")
            had_speech = False  # True quando detectou fala real no buffer

            def check_and_transcribe():
                """Checa timeouts e transcreve se necessario"""
                nonlocal state, last_sound_time, had_speech
                now = time.time()

                if state == "recording":
                    elapsed = now - recording_start
                    silence = now - last_sound_time
                    if elapsed > RECORD_MAX or (silence > SILENCE_TIMEOUT and elapsed > 0.5):
                        if had_speech and len(recording_buffer) > SAMPLE_RATE:
                            send("status", "Transcrevendo...")
                            text = transcribe_with_whisper(whisper_model, bytes(recording_buffer), SAMPLE_RATE)
                            recording_buffer.clear()
                            if text:
                                send("command", text)
                        else:
                            recording_buffer.clear()
                        state = "passive"
                        had_speech = False
                        wake_rec.Reset()
                        return True

                if state == "conversation":
                    silence = now - last_sound_time
                    if had_speech and len(recording_buffer) > SAMPLE_RATE and silence > CONVERSATION_SILENCE:
                        send("status", "Transcrevendo...")
                        text = transcribe_with_whisper(whisper_model, bytes(recording_buffer), SAMPLE_RATE)
                        recording_buffer.clear()
                        had_speech = False
                        last_sound_time = time.time()
                        if text:
                            if has_deactivate(text):
                                send("deactivated", "")
                                state = "passive"
                                wake_rec.Reset()
                            else:
                                send("command", text)
                        return True
                return False

            while True:
                try:
                    data = q.get(timeout=0.2)
                except queue.Empty:
                    check_and_transcribe()
                    continue

                # Checa timeout ANTES de processar dados
                check_and_transcribe()

                # === MODO PASSIVO: Vosk detecta wake word ===
                if state == "passive":
                    # Checa se veio RECORD do Electron (clique no mic)
                    if force_record_flag:
                        force_record_flag = False
                        state = "recording"
                        recording_buffer.clear()
                        had_speech = False
                        recording_start = time.time()
                        last_sound_time = time.time()
                        send("wake", "")
                        continue

                    if wake_rec.AcceptWaveform(data):
                        result = json.loads(wake_rec.Result())
                        text = result.get("text", "").strip()
                        if not text:
                            continue
                        if has_activate(text):
                            state = "conversation"
                            recording_buffer.clear()
                            had_speech = False
                            last_sound_time = time.time()
                            send("activated", "")
                        elif has_wake(text):
                            state = "recording"
                            recording_buffer.clear()
                            had_speech = False
                            recording_start = time.time()
                            last_sound_time = time.time()
                            send("wake", "")

                # === MODO RECORDING: gravando comando pra Whisper ===
                elif state == "recording":
                    recording_buffer.extend(data)
                    if has_sound(data):
                        last_sound_time = time.time()
                        had_speech = True
                    buf_secs = len(recording_buffer) / (SAMPLE_RATE * 2)
                    if had_speech:
                        send("partial", f"gravando... ({buf_secs:.1f}s)")

                # === MODO CONVERSA: grava tudo e transcreve com Whisper ===
                elif state == "conversation":
                    recording_buffer.extend(data)
                    if has_sound(data):
                        last_sound_time = time.time()
                        had_speech = True
                        buf_secs = len(recording_buffer) / (SAMPLE_RATE * 2)
                        send("partial", f"ouvindo... ({buf_secs:.1f}s)")

    except Exception as e:
        send("error", str(e))
        sys.exit(1)

# Stdin listener (SLEEP/WAKE/RECORD do Electron para TTS e mic)
def listen_stdin():
    global is_paused, force_record_flag
    for line in sys.stdin:
        cmd = line.strip()
        if cmd == "SLEEP":
            is_paused = True
        elif cmd == "WAKE":
            is_paused = False
        elif cmd == "RECORD":
            # Força inicio de gravação (como se tivesse falado "Buddy")
            force_record_flag = True

threading.Thread(target=listen_stdin, daemon=True).start()

if __name__ == "__main__":
    main()
