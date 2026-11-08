// All sound is synthesised with the Web Audio API; there are no audio files.
import { BLOCKS } from './blocks.js';

const STORAGE_KEY = 'eoins-building-game.muted';

export class GameAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.wind = null;
        this.muted = localStorage.getItem(STORAGE_KEY) === '1';
        this.lastStep = 0;
    }

    // Browsers only allow audio after a user gesture, so the context is created lazily.
    ensure() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return true;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise(2);
        return true;
    }

    makeNoise(seconds) {
        const length = Math.floor(this.ctx.sampleRate * seconds);
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    setMuted(muted) {
        this.muted = muted;
        localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
        if (this.master) {
            const now = this.ctx.currentTime;
            this.master.gain.cancelScheduledValues(now);
            this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.8, now + 0.1);
        }
    }

    toggleMuted() { this.setMuted(!this.muted); return this.muted; }

    // A short burst of filtered noise; the filter settings give each material its own character.
    noiseBurst({ duration = 0.08, freq = 800, q = 1, type = 'bandpass', gain = 0.5, sweepTo = null }) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
        const env = ctx.createGain();
        env.gain.setValueAtTime(gain, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        src.connect(filter).connect(env).connect(this.master);
        src.start();
        src.stop(ctx.currentTime + duration + 0.05);
    }

    tone({ freq = 220, to = null, duration = 0.1, type = 'sine', gain = 0.3 }) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
        const env = ctx.createGain();
        env.gain.setValueAtTime(gain, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(env).connect(this.master);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.05);
    }

    materialOf(blockId) {
        return (BLOCKS[blockId] && BLOCKS[blockId].sound) || 'stone';
    }

    place(blockId) {
        if (!this.ensure()) return;
        const m = this.materialOf(blockId);
        const jitter = 0.9 + Math.random() * 0.2;
        switch (m) {
            case 'wood':
                this.noiseBurst({ duration: 0.09, freq: 420 * jitter, q: 2, gain: 0.5 });
                this.tone({ freq: 190 * jitter, to: 120, duration: 0.09, type: 'triangle', gain: 0.25 });
                break;
            case 'soft':
            case 'sand':
                this.noiseBurst({ duration: 0.12, freq: 500 * jitter, type: 'lowpass', gain: 0.45 });
                break;
            case 'glass':
                this.tone({ freq: 1800 * jitter, to: 1400, duration: 0.12, type: 'sine', gain: 0.2 });
                this.noiseBurst({ duration: 0.05, freq: 3000, q: 4, gain: 0.2 });
                break;
            case 'leaves':
                this.noiseBurst({ duration: 0.14, freq: 1400 * jitter, q: 0.7, gain: 0.3 });
                break;
            case 'water':
                this.noiseBurst({ duration: 0.2, freq: 900 * jitter, sweepTo: 300, q: 1.5, gain: 0.35 });
                break;
            default:
                this.noiseBurst({ duration: 0.07, freq: 1100 * jitter, q: 1.5, gain: 0.5 });
                this.tone({ freq: 140 * jitter, to: 80, duration: 0.08, type: 'sine', gain: 0.3 });
        }
    }

    break(blockId) {
        if (!this.ensure()) return;
        const m = this.materialOf(blockId);
        const jitter = 0.9 + Math.random() * 0.2;
        if (m === 'glass') {
            for (let i = 0; i < 3; i++) {
                setTimeout(() => this.ctx && this.tone({ freq: (2200 + Math.random() * 1500) * jitter, to: 900, duration: 0.08, gain: 0.12 }), i * 25);
            }
            this.noiseBurst({ duration: 0.15, freq: 2500, q: 2, gain: 0.3 });
            return;
        }
        const freq = m === 'wood' ? 350 : m === 'soft' || m === 'sand' ? 320 : m === 'leaves' ? 1200 : 900;
        this.noiseBurst({ duration: 0.18, freq: freq * 2 * jitter, sweepTo: freq * 0.4, type: 'lowpass', gain: 0.6 });
        this.noiseBurst({ duration: 0.06, freq: freq * jitter, q: 3, gain: 0.4 });
    }

    footstep(blockId, speedFactor = 1) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        if (now - this.lastStep < 0.42 / speedFactor) return;
        this.lastStep = now;
        const m = this.materialOf(blockId);
        const freq = m === 'wood' ? 300 : m === 'soft' ? 220 : m === 'sand' ? 400 : 700;
        this.noiseBurst({ duration: 0.06, freq: freq * (0.9 + Math.random() * 0.2), type: m === 'stone' ? 'bandpass' : 'lowpass', q: 1, gain: 0.12 });
    }

    click() {
        if (!this.ensure()) return;
        this.tone({ freq: 900, to: 600, duration: 0.05, type: 'square', gain: 0.06 });
    }

    stamp() {
        if (!this.ensure()) return;
        this.noiseBurst({ duration: 0.25, freq: 600, sweepTo: 150, type: 'lowpass', gain: 0.6 });
        this.tone({ freq: 110, to: 60, duration: 0.25, type: 'sine', gain: 0.35 });
    }

    // Ambient wind: looping noise through a slowly wandering band-pass filter.
    startWind() {
        if (!this.ensure() || this.wind) return;
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.8;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 220;
        lfo.connect(lfoGain).connect(filter.frequency);
        const gustLfo = ctx.createOscillator();
        gustLfo.frequency.value = 0.045;
        const gustDepth = ctx.createGain();
        gustDepth.gain.value = 0.03;
        const gain = ctx.createGain();
        gain.gain.value = 0.045;
        gustLfo.connect(gustDepth).connect(gain.gain);
        src.connect(filter).connect(gain).connect(this.master);
        src.start();
        lfo.start();
        gustLfo.start();
        this.wind = { src, gain, filter };
    }

    // Higher ground is windier.
    updateWind(height) {
        if (!this.wind) return;
        const target = 0.03 + Math.max(0, Math.min(1, (height - 20) / 40)) * 0.07;
        this.wind.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 1.5);
    }
}
