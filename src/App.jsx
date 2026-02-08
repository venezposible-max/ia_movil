import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, User } from 'lucide-react';

// PLAN B: CLAVE INYECTADA DIRECTAMENTE
// Si __GROQ_KEY__ existe (porque Vite la inyectó), úsala. Si no, busca en .env local.
const API_KEY = (typeof __GROQ_KEY__ !== 'undefined' ? __GROQ_KEY__ : '') || import.meta.env.VITE_GROQ_API_KEY || '';

export default function App() {
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState([]);
    const [error, setError] = useState('');
    const [voiceGender, setVoiceGender] = useState('female');

    // DATOS DE USUARIO (PERSISTENTES)
    const [userName, setUserName] = useState(() => localStorage.getItem('olga_userName') || '');
    const [userBirthDate, setUserBirthDate] = useState(() => localStorage.getItem('olga_birthDate') || '');
    const [showSettings, setShowSettings] = useState(false);

    // REFS PARA ACCEDER AL ESTADO DENTRO DE LISTENERS ANTIGUOS
    const userNameRef = useRef(userName);
    const userBirthDateRef = useRef(userBirthDate);

    // ESTADOS CÁMARA (VISIÓN)
    const [showCamera, setShowCamera] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    useEffect(() => {
        userNameRef.current = userName;
        userBirthDateRef.current = userBirthDate;
        localStorage.setItem('olga_userName', userName);
        localStorage.setItem('olga_birthDate', userBirthDate);
    }, [userName, userBirthDate]);

    // FUNCIONES DE CÁMARA
    const startCamera = async () => {
        try {
            setShowCamera(true);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            setError('Error Cámara: ' + err.message);
            setShowCamera(false);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setShowCamera(false);
    };

    const analyzeImage = async () => {
        if (!videoRef.current || !canvasRef.current) return;
        setIsAnalyzing(true);
        speak("Déjame ver...");

        // 1. CAPTURAR FOTO
        const context = canvasRef.current.getContext('2d');
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        // RESIZE LÓGICO
        const MAX_WIDTH = 512;
        let width = videoRef.current.videoWidth;
        let height = videoRef.current.videoHeight;
        if (width > MAX_WIDTH) { const s = MAX_WIDTH / width; width = MAX_WIDTH; height = height * s; }

        canvasRef.current.width = width; canvasRef.current.height = height;
        context.drawImage(videoRef.current, 0, 0, width, height);
        const imageBase64 = canvasRef.current.toDataURL('image/jpeg', 0.6);

        try {
            // 2. ENVIAR A LLAMA 3.2 VISION
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", // NUEVO MODELO VISIÓN (2026)
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: `Describe BREVEMENTE qué ves en esta imagen. Habla como OLGA (soy tu usuario ${userName || 'amigo'}).` },
                                { type: "image_url", image_url: { url: imageBase64 } }
                            ]
                        }
                    ],
                    max_tokens: 150
                })
            });

            const data = await response.json();

            if (!response.ok) {
                const errMsg = data.error?.message || `Error API: ${response.status}`;
                throw new Error(errMsg);
            }

            if (!data.choices || !data.choices[0]) {
                throw new Error("No entendí lo que vi.");
            }

            const description = data.choices[0].message.content;

            // 3. RESPONDEMOS
            setMessages(prev => [...prev, { role: 'ai', text: "[👁️ VEO]: " + description }]);
            speak(description);

        } catch (e) {
            console.error(e);
            const msg = e.message || "Error desconocido";
            speak("Error visual.");
            setError("Fallo Visión: " + msg);
            window.alert("❌ Error Visión:\n" + msg); // ALERTA VISUAL
        } finally {
            setIsAnalyzing(false);
        }
    };

    const [svgContent, setSvgContent] = useState(null);
    const [generatedImage, setGeneratedImage] = useState(null);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState(false);

    const messagesRef = useRef([]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const recognitionRef = useRef(null);
    const synthRef = useRef(window.speechSynthesis);
    const abortControllerRef = useRef(null);

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

                // DETECCIÓN ESPECÍFICA PARA IPHONE/IPAD
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    if (isIOS) {
                        setError('🍎 En iPhone, Apple bloquea el micrófono en Chrome/Google. POR FAVOR USA SAFARI.');
                    } else {
                        setError('⚠️ Micrófono bloqueado. Revisa permisos o usa Chrome/Safari.');
                    }
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

    // PLAN B: SERPER KEY
    const SERPER_API_KEY = (typeof __SERPER_KEY__ !== 'undefined' ? __SERPER_KEY__ : '') || import.meta.env.VITE_SERPER_API_KEY || '';

    const handleUserMessage = async (text) => {
        const currentHistory = messagesRef.current;
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        // INTENCIÓN DE BÚSQUEDA
        const searchKeywords = ['precio', 'noticia', 'última hora', 'sucedió', 'pasó', 'actualidad', 'clima', 'cuánto', 'falleció', 'ganó', 'resultado', 'sismo', 'temblor'];
        const needsSearch = searchKeywords.some(kw => text.toLowerCase().includes(kw));

        let searchContext = '';

        if (needsSearch && SERPER_API_KEY) {
            try {
                console.log("Buscando en Google:", text);
                const searchRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: text, gl: 've', hl: 'es' })
                });
                const searchData = await searchRes.json();
                if (searchData.organic && searchData.organic.length > 0) {
                    // SIMPLIFICADO AL MAXIMO PARA DEBUG
                    searchContext = '\n\n[INFO]: Hay resultados de búsqueda, pero los he ocultado temporalmente por error de build.';
                }
            } catch (e) {
                console.error("Error buscar:", e);
            }
        }

        try {
            if (!API_KEY) throw new Error('Falta la API Key de GROQ en .env');

            const modelToUse = (needsSearch || text.length > 50) ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        {
                            role: "system", content: `Datos: Hoy es ${new Date().toLocaleDateString()}, hora ${new Date().toLocaleTimeString()}. Eres OLGA. 
                        INSTRUCCIONES:
                        1. Mantén el hilo.
                        2. Si preguntan la HORA: Dí SOLO la hora. 
                        3. USUARIO: ${userNameRef.current || 'Anónimo'}. (Cumpleaños: ${userBirthDateRef.current || 'Desconocido'})`
                        },
                        ...currentHistory.slice(-15).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
                        { role: "user", content: text + searchContext }
                    ],
                    temperature: 0.6,
                    max_tokens: 300
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error('Error Groq API');

            const data = await response.json();
            let aiText = data.choices[0].message.content;

            if (aiText.includes('GENERANDO_IMAGEN:')) {
                const prompt = aiText.replace('GENERANDO_IMAGEN:', '').trim();
                const safePrompt = encodeURIComponent(prompt.substring(0, 200));
                const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?nologo=true&width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}`;
                setGeneratedImage(imageUrl);
                setImageLoading(true);
                setImageError(false);
                aiText = "Creando imagen...";
            }

            const cleanText = aiText.replace(/\*/g, '');
            setMessages(prev => [...prev, { role: 'ai', text: cleanText }]);
            speak(cleanText);

        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(err.message);
                setMessages(prev => [...prev, { role: 'ai', text: 'Error: ' + err.message }]);
                speak('Hubo un error.');
            }
        } finally {
            setIsThinking(false);
        }
    };

    const speak = (text) => {
        if (synthRef.current.speaking) synthRef.current.cancel();
        const voiceText = text.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');
        const utterance = new SpeechSynthesisUtterance(voiceText);
        utterance.lang = 'es-US';

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        const voices = synthRef.current.getVoices();
        const esVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));
        const preferredNames = ['Google español', 'Paulina', 'Monica', 'Samantha', 'Helena', 'Sabina', 'Mexico'];
        const bestVoice = esVoices.find(v => preferredNames.some(n => v.name.includes(n)));
        if (bestVoice) utterance.voice = bestVoice;
        else if (esVoices.length > 0) utterance.voice = esVoices[0];

        synthRef.current.speak(utterance);
    };

    const toggleListening = () => {
        if (isSpeaking) {
            synthRef.current.cancel();
            setIsSpeaking(false);
            return;
        }
        if (isThinking) {
            if (abortControllerRef.current) abortControllerRef.current.abort();
            setIsThinking(false);
            return;
        }
        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            // TRUCO PARA MOVILES: Despertar el audio con un silbido silencioso
            // Esto "abre" el canal de audio para que luego la IA pueda hablar
            const wakeUp = new SpeechSynthesisUtterance(" ");
            wakeUp.volume = 0; // Silencio
            synthRef.current.speak(wakeUp);
            // Fin del truco

            setError('');
            recognitionRef.current?.start();
        }
    };

    return (
        <div className='container'>
            <div className='header'>
                <h1>⚡ OLGA AI</h1>
                <p>Neural Network • Llama 3 • Live Search</p>
                <span style={{ fontSize: '0.7rem', color: API_KEY ? '#4caf50' : '#ff5555', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                    {API_KEY ? '✅ Sistema Online' : `❌ Falta API Key (${API_KEY?.length || 0})`}
                </span>
            </div>

            <button
                onClick={() => setShowSettings(true)}
                title="Configuración"
                style={{
                    position: 'absolute', top: '90px', right: '20px', // MUCHO MÁS ABAJO
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%',
                    width: '50px', height: '50px', cursor: 'pointer', fontSize: '1.8rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
                    color: '#fff', backdropFilter: 'blur(10px)', boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                }}
            >
                ⚙️
            </button>

            {/* BOTÓN DE VISIÓN (OJO) */}
            <button
                onClick={startCamera}
                style={{
                    position: 'absolute', top: '90px', left: '20px', // A LA IZQUIERDA
                    background: 'rgba(0, 243, 255, 0.15)', border: '1px solid rgba(0, 243, 255, 0.3)', borderRadius: '50%',
                    width: '50px', height: '50px', cursor: 'pointer', fontSize: '1.8rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
                    color: '#00f3ff', backdropFilter: 'blur(10px)', boxShadow: '0 0 15px rgba(0, 243, 255, 0.2)'
                }}
                title="Activar Visión (Cámara)"
            >
                👁️
            </button>

            {/* PANTALLA DE CÁMARA (VISOR) */}
            {showCamera && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: '#000', zIndex: 99999, display: 'flex', flexDirection: 'column'
                }}>
                    <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    {/* UI DE CÁMARA */}
                    <button
                        onClick={stopCamera}
                        style={{
                            position: 'absolute', bottom: '50px', left: '30px', // ABAJO A LA IZQUIERDA
                            background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
                            borderRadius: '15px', padding: '10px 20px', fontSize: '1rem', fontWeight: 'bold', zIndex: 20,
                            backdropFilter: 'blur(5px)'
                        }}
                    >
                        ⬅️ Volver
                    </button>

                    <button
                        onClick={analyzeImage}
                        disabled={isAnalyzing}
                        style={{
                            position: 'absolute', bottom: '50px', left: '50%', transform: 'translateX(-50%)',
                            background: isAnalyzing ? '#555' : '#fff',
                            color: '#000', border: '5px solid rgba(255,255,255,0.3)',
                            borderRadius: '50%', width: '80px', height: '80px',
                            fontSize: '2rem', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 20px rgba(255,255,255,0.5)'
                        }}
                    >
                        {isAnalyzing ? '⏳' : '📸'}
                    </button>

                    {isAnalyzing && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            color: '#00f3ff', fontSize: '1.5rem', fontWeight: 'bold', background: 'rgba(0,0,0,0.7)',
                            padding: '10px 20px', borderRadius: '20px'
                        }}>
                            🧠 Analizando...
                        </div>
                    )}
                </div>
            )}
            <div className='main-content'>

                {generatedImage && (
                    <div className="art-canvas" style={{
                        marginBottom: '20px', padding: '5px', background: 'rgba(255,255,255,0.1)',
                        borderRadius: '15px', boxShadow: '0 0 40px rgba(188, 19, 254, 0.4)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        overflow: 'hidden', width: '300px', height: '300px',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        position: 'relative'
                    }}>
                        {imageLoading && <div style={{ position: 'absolute', color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '5px 10px', borderRadius: '10px' }}>🎨 Pintando...</div>}

                        {imageError ? (
                            <div style={{ color: '#ff5555', textAlign: 'center', padding: '20px' }}>
                                <p>⚠️ Error de Imagen</p>
                            </div>
                        ) : (
                            <img
                                src={generatedImage}
                                alt="Arte Generado"
                                style={{
                                    width: '100%', height: '100%', borderRadius: '10px', objectFit: 'cover',
                                    opacity: imageLoading ? 0 : 1, transition: 'opacity 0.5s'
                                }}
                                onLoad={() => setImageLoading(false)}
                                onError={() => { setImageLoading(false); setImageError(true); }}
                            />
                        )}
                    </div>
                )}

                <div className='orb-container'>
                    <button
                        className={`orb-button ${isListening ? 'listening' : ''} ${isThinking ? 'thinking' : ''} ${isSpeaking ? 'speaking' : ''}`}
                        onClick={toggleListening}
                    >
                        {isThinking ? <Loader className='icon spin' size={64} /> :
                            isListening ? <Mic className='icon' size={64} /> :
                                isSpeaking ? <Volume2 className='icon' size={64} /> :
                                    <MicOff className='icon' size={64} />}
                    </button>
                    <div className='status-text' style={{ marginTop: '20px' }}>
                        {isListening ? 'Escuchando...' : isThinking ? 'Procesando...' : isSpeaking ? 'Hablando...' : 'Toca para hablar'}
                    </div>
                    {error && <div className='error-msg'>{error}</div>}
                </div>

                <div className='chat-log'>
                    {messages.slice(-2).map((msg, idx) => (
                        <div key={idx} className={`message ${msg.role}`}>
                            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                            <span>{msg.text}</span>
                        </div>
                    ))}
                </div>

                {/* MODAL DE CONFIGURACIÓN */}
                {showSettings && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.92)', zIndex: 99999, // ENCIMA DE TODO
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        backdropFilter: 'blur(15px)'
                    }}>
                        <div style={{
                            background: '#1a1a2e', padding: '25px', borderRadius: '25px',
                            width: '85%', maxWidth: '350px', border: '1px solid rgba(0,243,255,0.3)',
                            boxShadow: '0 0 50px rgba(0,243,255,0.2)', color: '#fff'
                        }}>
                            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#00f3ff', textAlign: 'center', fontSize: '1.5rem' }}>
                                ⚙️ Ajustes
                            </h2>

                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem', color: '#aaa' }}>Tu Nombre:</label>
                                <input
                                    type="text" value={userName} onChange={e => setUserName(e.target.value)}
                                    placeholder="Ej: Franklin"
                                    style={{
                                        width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #333',
                                        background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '1rem'
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: '25px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem', color: '#aaa' }}>Fecha de Nacimiento:</label>
                                <input
                                    type="date" value={userBirthDate} onChange={e => setUserBirthDate(e.target.value)}
                                    style={{
                                        width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #333',
                                        background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '1rem'
                                    }}
                                />
                            </div>

                            <button
                                onClick={() => setShowSettings(false)}
                                style={{
                                    width: '100%', padding: '15px', borderRadius: '15px', border: 'none',
                                    background: 'linear-gradient(90deg, #00c6ff, #0072ff)', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem',
                                    marginBottom: '20px', cursor: 'pointer'
                                }}
                            >
                                ¡Guardar y Cerrar!
                            </button>

                            <div style={{ borderTop: '1px solid #333', paddingTop: '20px', textAlign: 'center' }}>
                                <button
                                    onClick={() => {
                                        if (window.confirm('¿Seguro que quieres borrar toda la memoria?')) {
                                            setMessages([]);
                                            setSvgContent(null);
                                            setGeneratedImage(null);
                                            if (isSpeaking) synthRef.current.cancel();
                                            setIsSpeaking(false);
                                            setShowSettings(false);
                                        }
                                    }}
                                    style={{ color: '#ff5555', background: 'transparent', border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}
                                >
                                    🗑️ Borrar Memoria y Reiniciar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
