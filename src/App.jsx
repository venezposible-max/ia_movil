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

        // 1. CRIPTO CHECK
        let searchContext = '';
        const cryptoMap = { 'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT', 'solana': 'SOLUSDT' };
        let cryptoSymbol = null;
        for (const [key, val] of Object.entries(cryptoMap)) { if (text.toLowerCase().includes(key)) { cryptoSymbol = val; break; } }

        if (cryptoSymbol) {
            try {
                const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cryptoSymbol}`);
                const data = await res.json();
                if (data.price) searchContext = `[PRECIO ${cryptoSymbol}: $${parseFloat(data.price).toFixed(2)}] `;
            } catch (e) { }
        }

        // 2. BUSCADOR GOOGLE (MODO NOTICIAS AGRESIVO)
        // Palabras que ACTIVAN la búsqueda obligatoria para no alucinar con datos viejos
        const newsTriggers = [
            'precio', 'noticia', 'última hora', 'sucedió', 'pasó', 'actualidad', 'clima',
            'falleció', 'ganó', 'resultado', 'sismo', 'temblor', 'quién es', 'qué es', 'buscar',
            'dónde está', 'donde esta', 'preso', 'cárcel', 'situación', 'gobierno',
            'maduro', 'corina', 'edmundo', 'venezuela', 'trump', 'biden', 'putin' // Nombres clave política
        ];

        const needsSearch = !searchContext && newsTriggers.some(kw => text.toLowerCase().includes(kw));

        if (needsSearch && SERPER_API_KEY) {
            try {
                // console.log("Buscando noticias recientes...");
                const searchRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: text + " noticias hoy 2026", gl: 've', hl: 'es' }) // Forzamos contexto reciente
                });
                const searchData = await searchRes.json();
                if (searchData.organic && searchData.organic.length > 0) {
                    const topResults = searchData.organic.slice(0, 5).map(r => `[FUENTE: ${r.title}] -> ${r.snippet}`).join('\n'); // 5 resultados
                    searchContext += `\n\n[MUNDO REAL (IGNORA TU ENTRENAMIENTO SI CHOCA CON ESTO)]:\n${topResults}`;
                }
            } catch (e) { console.error(e); }
        }

        // 3. INYECCIÓN DE CONTEXTO PERSONAL (NOMBRE Y FECHA)
        const now = new Date();
        let userInfo = `Usuario Anónimo.`;

        if (userNameRef.current) {
            userInfo = `Usuario: ${userNameRef.current}.`;
        }

        if (userBirthDateRef.current) {
            const birth = new Date(userBirthDateRef.current);
            const ageDifMs = Date.now() - birth.getTime();
            const ageDate = new Date(ageDifMs); // milisegundos desde epoch
            const age = Math.abs(ageDate.getUTCFullYear() - 1970);
            userInfo += ` Edad: ${age} años (Nació: ${userBirthDateRef.current}).`;
        }

        const timeInfo = `[SISTEMA: Hoy es ${now.toLocaleDateString()} ${now.toLocaleTimeString()}. ${userInfo}]`;

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: `Eres OLGA, una IA leal y útil. ${userInfo} Responde de forma personal usando el nombre del usuario si viene al caso. Si hay resultados de búsqueda, úsalos sobre tu base de conocimientos.` },
                        ...messagesRef.current.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
                        { role: "user", content: text + searchContext + "\n" + timeInfo }
                    ],
                    max_tokens: 300
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error('Error Groq');
            const data = await response.json();
            const aiText = data.choices[0].message.content;

            if (aiText.includes('GENERANDO_IMAGEN:')) {
                setMessages(prev => [...prev, { role: 'ai', text: "Generando imagen..." }]);
                // Image logic would go here
            } else {
                setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
                speak(aiText);
            }

        } catch (e) {
            if (e.name !== 'AbortError') {
                setMessages(prev => [...prev, { role: 'ai', text: "Error: " + e.message }]);
                speak("Error.");
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
            const esVoices = allVoices.filter(v => v.lang.toLowerCase().includes('es'));
            selectedVoice = esVoices.find(v =>
                v.name.includes('Paulina') || v.name.includes('Mexico') || v.name.includes('Google español de Estados Unidos')
            ) || esVoices.find(v => !v.name.toLowerCase().includes('monica')) || esVoices[0];
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang;
        } else {
            utterance.lang = 'es-MX';
        }

        utterance.pitch = 1.0;
        utterance.rate = 1.1;

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
