import wave
import math
import struct
import base64

def create_beep_wav(filename, freq=440, duration=0.5, rate=8000):
    num_samples = int(duration * rate)
    wav_file = wave.open(filename, 'wb')
    wav_file.setnchannels(1)
    wav_file.setsampwidth(1) # 8-bit PCM
    wav_file.setframerate(rate)
    
    for i in range(num_samples):
        t = float(i) / rate
        # Fade in and out to prevent clicking
        fade = 1.0
        fade_len = 0.05
        if t < fade_len:
            fade = t / fade_len
        elif t > duration - fade_len:
            fade = (duration - t) / fade_len
            
        # 8-bit PCM is unsigned: values from 0 to 255 (128 is silence)
        value = int(128 + 127.0 * math.sin(2.0 * math.pi * freq * t) * fade)
        # Ensure it fits in unsigned byte
        value = max(0, min(255, value))
        data = struct.pack('B', value)
        wav_file.writeframesraw(data)
        
    wav_file.close()

if __name__ == '__main__':
    filename = 'temp_beep.wav'
    create_beep_wav(filename, freq=440, duration=0.5, rate=8000)
    with open(filename, 'rb') as f:
        encoded = base64.b64encode(f.read()).decode('utf-8')
    print(f"data:audio/wav;base64,{encoded}")
