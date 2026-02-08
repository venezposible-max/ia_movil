import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, User } from 'lucide-react';

// PLAN B: CLAVE INYECTADA DIRECTAMENTE
const API_KEY = (typeof __GROQ_KEY__ !== 'undefined' ? __GROQ_KEY__ : '') || import.meta.env.VITE_GROQ_API_KEY || '';

export default function App() {
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState([]);
    const [error, setError] = useState('');

    // DATOS DE USUARIO
    const [userName, setUserName] = useState(() => localStorage.getItem('olga_user_name') || '');
    const [userBirthDate, setUserBirthDate] = useState(() => localStorage.getItem('olga_user_birth') || '');
    const [showSettings, setShowSettings] = useState(false);

    // SELECCIÓN DE VOZ
    const [availableVoices, setAvailableVoices] = useState([]);
    const [selectedVoiceName, setSelectedVoiceName] = useState(() => localStorage.getItem('olga_voice_name') || '');

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            const esVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));
            setAvailableVoices(esVoices);
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }, []);

    const userNameRef = useRef(userName);
    const userBirthDateRef = useRef(userBirthDate);
    const messagesRef = useRef([]);
    const recognitionRef = useRef(null);
    const synthRef = useRef(window.speechSynthesis);
    const abortControllerRef = useRef(null);

    // ALARMAS
    const [alarms, setAlarms] = useState([]);

    // VIGILANTE DE ALARMAS
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const currentHM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            // Solo mirar segundos 00 para no repetir mucho
            if (now.getSeconds() !== 0) return;

            setAlarms(prev => {
                const triggered = prev.filter(al => al.time === currentHM);
                const remaining = prev.filter(al => al.time !== currentHM);

                if (triggered.length > 0) {
                    triggered.forEach(t => {
                        speak(`¡Atención! Es la hora de: ${t.label}`);
                        // Sonido de Alarma (Oscilador navegador para no depender de archivos)
                        playAlarmSound();
                    });
                }
                return remaining;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const playAlarmSound = () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1);
        osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1);
    };

    // CÁMARA & IMAGEN
    const [showCamera, setShowCamera] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [generatedImage, setGeneratedImage] = useState(null);
    const [imageLoading, setImageLoading] = useState(false);

    useEffect(() => {
        userNameRef.current = userName;
        userBirthDateRef.current = userBirthDate;
        localStorage.setItem('olga_user_name', userName);
        localStorage.setItem('olga_user_birth', userBirthDate);
    }, [userName, userBirthDate]);

    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // WAKE LOCK (Mantener pantalla encendida para alarmas)
    useEffect(() => {
        let wakeLock = null;
        const requestWakeLock = async () => {
            if ('wakeLock' in navigator) {
                try {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('💡 Pantalla mantenida encendida (Wake Lock activo)');
                } catch (err) {
                    console.error(`${err.name}, ${err.message}`);
                }
            }
        };

        const handleVisibilityChange = () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        };

        requestWakeLock();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // --- RECONOCIMIENTO DE VOZ ---
    useEffect(() => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'es-419';

            recognition.onstart = () => { setIsListening(true); setError(''); };
            recognition.onend = () => { setIsListening(false); };
            recognition.onerror = (e) => {
                if (e.error === 'no-speech') return;
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    setError(isIOS ? '🍎 En iPhone usa Safari.' : '⚠️ Micrófono bloqueado.');
                } else {
                    setError('Error Voz: ' + e.error);
                }
                setIsListening(false);
            };
            recognition.onresult = (e) => {
                const t = e.results[0][0].transcript;
                if (t.trim()) handleUserMessage(t);
            };
            recognitionRef.current = recognition;
        } else {
            setError('Navegador no compatible. Usa Chrome.');
        }
    }, []);

    // --- CÁMARA ---
    const startCamera = async () => {
        try {
            setShowCamera(true);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (videoRef.current) { videoRef.current.srcObject = stream; }
        } catch (err) {
            setError('Error Cámara: ' + err.message);
            setShowCamera(false);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setShowCamera(false);
    };

    const analyzeImage = async () => {
        if (!videoRef.current || !canvasRef.current) return;
        setIsAnalyzing(true);
        speak("Déjame ver...");

        const context = canvasRef.current.getContext('2d');
        const MAX_WIDTH = 512;
        let width = videoRef.current.videoWidth;
        let height = videoRef.current.videoHeight;
        if (width > MAX_WIDTH) { const s = MAX_WIDTH / width; width = MAX_WIDTH; height = height * s; }

        canvasRef.current.width = width; canvasRef.current.height = height;
        context.drawImage(videoRef.current, 0, 0, width, height);
        const imageBase64 = canvasRef.current.toDataURL('image/jpeg', 0.6);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", // VISION MODEL 2026
                    messages: [
                        { role: "user", content: [{ type: "text", text: `Describe BREVEMENTE qué ves. Eres OLGA.` }, { type: "image_url", image_url: { url: imageBase64 } }] }
                    ],
                    max_tokens: 150
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || 'Error API Vision');
            const description = data.choices[0].message.content;

            setMessages(prev => [...prev, { role: 'ai', text: "[👁️ VEO]: " + description }]);
            speak(description);
        } catch (e) {
            console.error(e);
            speak("No pude ver bien.");
            alert("Error Visión: " + e.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // --- CORE LOGIC ---
    const SERPER_API_KEY = (typeof __SERPER_KEY__ !== 'undefined' ? __SERPER_KEY__ : '') || import.meta.env.VITE_SERPER_API_KEY || '';

    const handleUserMessage = async (text) => {
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        try {
            let contextParts = [];
            const textLower = text.toLowerCase();

            // 1. CRIPTO CHECK
            const cryptoMap = { 'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT', 'solana': 'SOLUSDT' };
            let cryptoSymbol = null;
            for (const [key, val] of Object.entries(cryptoMap)) { if (textLower.includes(key)) { cryptoSymbol = val; break; } }
            if (cryptoSymbol) {
                try {
                    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cryptoSymbol}`);
                    const data = await res.json();
                    if (data.price) contextParts.push(`[PRECIO ${cryptoSymbol}: $${parseFloat(data.price).toFixed(2)}]`);
                } catch (e) { }
            }

            // 2. NOTICIAS (POLÍTICA Y ACTUALIDAD)
            const newsTriggers = ['precio', 'noticia', 'última hora', 'pasó', 'actualidad', 'falleció', 'ganó', 'sismo', 'maduro', 'corina', 'venezuela', 'trump', 'biden', 'dónde está', 'donde esta', 'preso', 'situación'];
            if (newsTriggers.some(kw => textLower.includes(kw)) && SERPER_API_KEY) {
                try {
                    const searchRes = await fetch('https://google.serper.dev/search', {
                        method: 'POST',
                        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ q: text + " noticias 2026", gl: 've', hl: 'es' })
                    });
                    const searchData = await searchRes.json();
                    if (searchData.organic?.length > 0) {
                        const results = searchData.organic.slice(0, 5).map(r => `• ${r.title}: ${r.snippet}`).join('\n');
                        contextParts.push(`[RESULTADOS BÚSQUEDA REAL]:\n${results}`);
                    }
                } catch (e) { console.error("Search error", e); }
            }

            // 3. DATOS DE USUARIO
            let userInfo = "Usuario: Anónimo (haz que se identifique en ajustes).";
            if (userNameRef.current) userInfo = `Usuario: ${userNameRef.current}.`;
            if (userBirthDateRef.current) {
                const age = Math.abs(new Date(Date.now() - new Date(userBirthDateRef.current).getTime()).getUTCFullYear() - 1970);
                userInfo += ` Edad: ${age} años.`;
            }

            // 4. ALARMAS
            let alarmMsg = "";
            const timeMatch = text.match(/(?:alarma|despiertame|avisame).+?(\d{1,2})[:\.](\d{2})/i);
            const inMatch = text.match(/(?:alarma|despiertame|avisame).+?(\d+)\s*(?:min|seg)/i);

            if (timeMatch || inMatch) {
                let targetTime = "";
                let label = "Alarma";
                if (timeMatch) {
                    let h = parseInt(timeMatch[1]);
                    const m = timeMatch[2].padStart(2, '0');
                    if (textLower.includes('pm') && h < 12) h += 12;
                    else if (textLower.includes('am') && h === 12) h = 0;
                    targetTime = `${h.toString().padStart(2, '0')}:${m}`;
                } else if (inMatch) {
                    const val = parseInt(inMatch[1]);
                    const isSeg = textLower.includes('seg');
                    const d = new Date(Date.now() + val * (isSeg ? 1000 : 60000));
                    targetTime = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                    label = `En ${val} ${isSeg ? 'seg' : 'min'}`;
                }

                setAlarms(prev => [...prev, { time: targetTime, label, id: Date.now() }]);
                alarmMsg = `[SISTEMA: Alarma configurada a las ${targetTime}]`;
            }

            // 5. CONSTRUCCIÓN FINAL
            const now = new Date();
            const systemContext = `[SISTEMA: Hoy es ${now.toLocaleDateString()} ${now.toLocaleTimeString()}. ${userInfo}] ${alarmMsg} ${contextParts.join('\n')}`;

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant", // MODO TURBO (RAPIDÍSIMO Y SEGURO)
                    messages: [
                        { role: "system", content: `Eres OLGA, asistente virtual en español. ${userInfo} IMPORTANTE: ERES ÚTIL Y BREVE. Si hay alarmas o noticias, confírmalo.` },
                        ...messagesRef.current.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })), // Reducimos contexto a 6 para evitar overflow
                        { role: "user", content: text + "\n" + systemContext }
                    ],
                    max_tokens: 400
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new Error(errData.error?.message || `Error Groq: ${response.status}`);
            }

            const data = await response.json();
            const aiText = data.choices[0].message.content;

            if (aiText.includes('GENERANDO_IMAGEN:')) {
                setMessages(prev => [...prev, { role: 'ai', text: "🎨 Generando arte..." }]);
            } else {
                setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
                speak(aiText);
            }

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                setMessages(prev => [...prev, { role: 'ai', text: "Error: " + e.message }]);
                speak("Tuve un error.");
            }
        } finally {
            setIsThinking(false);
        }
    };

    const speak = (text, forceVoiceName = null) => {
        if (synthRef.current.speaking) synthRef.current.cancel();

        const cleanText = text.replace(/[*#]/g, '').replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');
        const utterance = new SpeechSynthesisUtterance(cleanText);

        // 1. VOZ (Usuario o Auto)
        const targetName = forceVoiceName || selectedVoiceName;
        const allVoices = window.speechSynthesis.getVoices();
        let selectedVoice = null;

        if (targetName) {
            selectedVoice = allVoices.find(v => v.name === targetName);
        }

        if (!selectedVoice) {
            // ALERTA ANTI-PORTUGUÉS: FILTRADO ESTRICTO
            const cleanVoices = allVoices.filter(v =>
                v.lang.toLowerCase().startsWith('es') &&
                !v.name.toLowerCase().includes('portu') &&
                !v.name.toLowerCase().includes('brazil') &&
                !v.name.toLowerCase().includes('br') &&
                !v.lang.toLowerCase().includes('pt')
            );

            // BUSQUEDA PRIORITARIA LATINA
            selectedVoice = cleanVoices.find(v => v.name.includes('Paulina')) ||
                cleanVoices.find(v => v.name.includes('Sabina')) ||
                cleanVoices.find(v => v.name.includes('Mexico')) ||
                cleanVoices.find(v => v.name.includes('Google español de Estados Unidos')) ||
                cleanVoices.find(v => v.lang === 'es-MX') ||
                cleanVoices.find(v => v.lang === 'es-US') ||
                cleanVoices.find(v => v.lang === 'es-419') ||
                cleanVoices[0];
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang;
        } else {
            utterance.lang = 'es-MX';
        }

        utterance.pitch = 1.05;
        utterance.rate = 1.15;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        synthRef.current.speak(utterance);
    };

    const toggleListening = () => {
        if (isSpeaking) { synthRef.current.cancel(); setIsSpeaking(false); return; }
        if (isThinking) return;
        if (isListening) recognitionRef.current?.stop();
        else {
            const wakeUp = new SpeechSynthesisUtterance(" ");
            wakeUp.volume = 0;
            synthRef.current.speak(wakeUp);
            setError('');
            recognitionRef.current?.start();
        }
    };

    // --- DISEÑO CLÁSICO (RESTORED) ---
    return (
        <div className='container'>

            {/* HEADER CLÁSICO */}
            <div className='header'>
                <h1>⚡ OLGA AI</h1>
                <p>Neural Network • Llama 4 • Live Search</p>
                <span style={{ fontSize: '0.7rem', color: API_KEY ? '#4caf50' : '#ff5555', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                    {API_KEY ? '✅ Sistema Online' : `❌ Falta API Key (${API_KEY?.length || 0})`}
                </span>
            </div>

            {/* BOTÓN CONFIG (ENGRANAJE) - POSICIÓN CORREGIDA */}
            <button
                onClick={() => setShowSettings(true)}
                title="Configuración"
                style={{
                    position: 'absolute', top: 'calc(20px + env(safe-area-inset-top))', right: '20px',
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%',
                    width: '50px', height: '50px', cursor: 'pointer', fontSize: '1.8rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
                    color: '#fff', backdropFilter: 'blur(10px)', boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                }}
            >
                ⚙️
            </button>

            {/* BOTÓN VISIÓN (OJO) - POSICIÓN CORREGIDA */}
            <button
                onClick={startCamera}
                title="Activar Visión"
                style={{
                    position: 'absolute', top: 'calc(20px + env(safe-area-inset-top))', left: '20px',
                    background: 'rgba(0, 243, 255, 0.15)', border: '1px solid rgba(0, 243, 255, 0.3)', borderRadius: '50%',
                    width: '50px', height: '50px', cursor: 'pointer', fontSize: '1.8rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
                    color: '#00f3ff', backdropFilter: 'blur(10px)', boxShadow: '0 0 15px rgba(0, 243, 255, 0.2)'
                }}
            >
                👁️
            </button>

            {/* CONTENIDO PRINCIPAL (ORBE) */}
            <div className='main-content'>

                {generatedImage && (
                    <div style={{ marginBottom: '20px', padding: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '15px' }}>
                        <img src={generatedImage} alt="Arte" style={{ width: '300px', borderRadius: '10px' }} />
                    </div>
                )}

                <div className='orb-container'>
                    <button
                        className={`orb-button ${isListening ? 'listening' : ''} ${isThinking ? 'thinking' : ''} ${isSpeaking ? 'speaking' : ''}`}
                        onClick={toggleListening}
                    >
                        {/* AVATAR REALISTA - SIEMPRE VISIBLE */}
                        <img
                            src="/avatar.png"
                            className="avatar-img"
                            alt="OLGA AI"
                            onError={(e) => { e.target.style.display = 'none'; }} // Fallback invisible si no copian la imagen
                        />

                        {/* Fallback Icon si la imagen falla (opcional) */}
                        <div className="icon-fallback" style={{ position: 'absolute', zIndex: -1 }}>
                            <Bot size={64} color="#fff" />
                        </div>
                    </button>
                    <div className='status-text'>
                        {isThinking ? 'Procesando...' : isSpeaking ? 'Hablando...' : isListening ? 'Escuchando...' : 'TOCA PARA HABLAR'}
                    </div>
                </div>

                {error && <div className='error-msg'>⚠️ {error}</div>}
            </div>

            {/* CHAT LOG */}
            <div className='chat-log'>
                {messages.length === 0 && <div style={{ opacity: 0.5, textAlign: 'center', fontSize: '0.8rem' }}>Historial vacío</div>}
                {messages.slice(-3).map((msg, idx) => (
                    <div key={idx} className={`message ${msg.role}`}>
                        <strong>{msg.role === 'ai' ? '🤖' : '👤'}:</strong> {msg.text}
                    </div>
                ))}
            </div>

            {/* CÁMARA UI - REPARADA (BOTONES ALTOS) */}
            {showCamera && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh', // 100dvh IMPORTANTE
                    background: '#000', zIndex: 999999, display: 'flex', flexDirection: 'column'
                }}>
                    <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    <button onClick={stopCamera} style={{
                        position: 'absolute', bottom: 'calc(120px + env(safe-area-inset-bottom))', left: '20px',
                        background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: '30px', padding: '12px 24px', fontSize: '1rem', fontWeight: 'bold', zIndex: 100,
                        backdropFilter: 'blur(5px)'
                    }}>⬅️ Volver</button>

                    <button onClick={analyzeImage} disabled={isAnalyzing} style={{
                        position: 'absolute', bottom: 'calc(120px + env(safe-area-inset-bottom))',
                        left: '50%', transform: 'translateX(-50%)',
                        background: isAnalyzing ? '#555' : '#fff',
                        color: '#000', border: '5px solid rgba(255,255,255,0.3)',
                        borderRadius: '50%', width: '80px', height: '80px',
                        fontSize: '2rem', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 20px rgba(255,255,255,0.5)'
                    }}>
                        {isAnalyzing ? '⏳' : '📸'}
                    </button>

                    {isAnalyzing && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            color: '#00f3ff', fontSize: '1.5rem', fontWeight: 'bold', background: 'rgba(0,0,0,0.7)',
                            padding: '10px 20px', borderRadius: '20px', zIndex: 101, pointerEvents: 'none'
                        }}>🧠 Analizando...</div>
                    )}
                </div>
            )}

            {/* SETTINGS MODAL */}
            {showSettings && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh',
                    background: 'rgba(0,0,0,0.95)', zIndex: 99999, display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div style={{ width: '85%', maxWidth: '350px', color: '#fff', textAlign: 'left', background: '#111', padding: '25px', borderRadius: '20px', border: '1px solid #333' }}>
                        <h2 style={{ textAlign: 'center', margin: '0 0 20px 0', color: '#00f3ff' }}>⚙️ Ajustes</h2>

                        <label style={{ display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '0.9rem' }}>Voz de OLGA:</label>
                        <select
                            value={selectedVoiceName}
                            onChange={(e) => {
                                setSelectedVoiceName(e.target.value);
                                localStorage.setItem('olga_voice_name', e.target.value);
                                speak("Soy OLGA.", e.target.value);
                            }}
                            style={{
                                width: '100%', padding: '12px', marginBottom: '20px',
                                borderRadius: '10px', background: '#222', color: '#fff', border: '1px solid #444',
                                fontSize: '0.9rem'
                            }}
                        >
                            <option value="">-- Automática (Mejor) --</option>
                            {availableVoices.map(v => (
                                <option key={v.name} value={v.name}>
                                    {v.name.replace('Microsoft ', '').replace('Google ', '').substring(0, 30)} ({v.lang})
                                </option>
                            ))}
                        </select>

                        <label style={{ display: 'block', marginBottom: '8px', color: '#aaa', fontSize: '0.9rem' }}>Tu Nombre:</label>
                        <input
                            type="text"
                            value={userName}
                            onChange={e => setUserName(e.target.value)}
                            placeholder="Ej: Franklin"
                            style={{ width: '100%', padding: '12px', marginBottom: '20px', borderRadius: '10px', border: 'none', background: '#222', color: '#fff' }}
                        />

                        <label style={{ display: 'block', marginBottom: '8px', color: '#aaa', fontSize: '0.9rem' }}>Fecha de Nacimiento:</label>
                        <input
                            type="date"
                            value={userBirthDate}
                            onChange={e => setUserBirthDate(e.target.value)}
                            style={{ width: '100%', padding: '12px', marginBottom: '30px', borderRadius: '10px', border: 'none', background: '#222', color: '#fff' }}
                        />

                        <button
                            onClick={() => setShowSettings(false)}
                            style={{ width: '100%', padding: '15px', background: 'linear-gradient(90deg, #00c6ff, #0072ff)', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer' }}
                        >
                            ¡Guardar!
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
