import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, User } from 'lucide-react';

// AHORA USAMOS GROQ (Más rápido y gratis)
const API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

export default function App() {
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState([]);
    const [error, setError] = useState('');
    const [voiceGender, setVoiceGender] = useState('female');

    const messagesRef = useRef([]); // REFERENCIA PARA MEMORIA REAL (Evita bugs de closure)

    // Sincronizar Ref con Estado
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
                if (e.error !== 'no-speech') setError('Error Voz: ' + e.error);
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

    // NUEVA KEY DE BUSQUEDA
    const SERPER_API_KEY = import.meta.env.VITE_SERPER_API_KEY || '';

    const handleUserMessage = async (text) => {
        // Usamos el Ref para obtener la historia REAL y ACTUALIZADA, no la vieja
        const currentHistory = messagesRef.current;

        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        // 1. DETECTAR INTENCIÓN DE BÚSQUEDA
        // Quitamos nombres propios (Venezuela, Maduro, EEUU) para que no busque siempre que los menciones.
        // Ahora solo buscará si hay INTENCIÓN DE INFORMACIÓN ("precio", "noticia", "cuándo").
        const searchKeywords = ['precio', 'noticia', 'última hora', 'sucedió', 'pasó', 'actualidad', 'clima', 'cuánto', 'falleció', 'ganó', 'resultado', 'sismo', 'temblor'];

        // Solo buscamos si hay una keyword DE BÚSQUEDA explícita
        const needsSearch = searchKeywords.some(kw => text.toLowerCase().includes(kw));

        let searchContext = '';

        // 2. BUSCAR EN GOOGLE (Si hace falta)
        if (needsSearch && SERPER_API_KEY) {
            try {
                setIsThinking(true); // Feedback visual extra
                console.log("Buscando en Google:", text);

                const searchRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': SERPER_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ q: text, gl: 've', hl: 'es' }) // Localizado en Venezuela/Español
                });

                const searchData = await searchRes.json();

                if (searchData.organic && searchData.organic.length > 0) {
                    // Tomar los 3 primeros resultados
                    const snippets = searchData.organic.slice(0, 3).map(r => `Title: ${r.title}\nSnippet: ${r.snippet}`).join('\n\n');
                    searchContext = `\n\n[CONTEXTO DE BÚSQUEDA (INFORMACIÓN ACTUALIZADA)]:\n${snippets}\n\nUsa esta información si es relevante.`;
                }
            } catch (e) {
                console.error("Error buscar:", e);
            }
        }

        try {
            if (!API_KEY) throw new Error('Falta la API Key de GROQ en .env');

            // SELECCIÓN DE MODELO DINÁMICO (Velocidad vs Inteligencia)
            // Si hay búsqueda o texto largo -> Modelo Grande (70b)
            // Si es charla casual -> Modelo Rápido (8b instant)
            const modelToUse = (needsSearch || text.length > 50) ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

            // CONEXIÓN A GROQ
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
                            role: "system", content: `Datos: Hoy es ${new Date().toLocaleDateString()}, hora ${new Date().toLocaleTimeString()}. Eres OLGA, una IA inteligente y empática. 
                        
                        INSTRUCCIONES DE CONTINUIDAD:
                        1. MANTÉN EL HILO. Si hiciste una pregunta antes, la respuesta del usuario es sobre eso.
                        2. CONTEXTO: Recuerda todo lo que hemos hablado en esta sesión.
                        3. PERSONALIDAD: Eres curiosa y conversadora.
                        4. Si preguntan la HORA: Dí SOLO la hora. 
                        5. RESPONDE SIEMPRE EN ESPAÑOL.` },

                        // USAMOS LA MEMORIA DEL REF (¡ESTA SÍ TIENE DATOS!)
                        ...currentHistory.slice(-15).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),

                        { role: "user", content: text + searchContext }
                    ],
                    temperature: 0.6,
                    max_tokens: 300
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'Error Groq API');
            }

            const data = await response.json();
            let aiText = data.choices[0].message.content;

            const cleanText = aiText.replace(/\*/g, ''); // Limpiar markdown
            setMessages(prev => [...prev, { role: 'ai', text: cleanText }]);
            speak(cleanText);

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                setError(err.message);
                setMessages(prev => [...prev, { role: 'ai', text: 'Error: ' + err.message }]);
                speak('Hubo un error de conexión.');
            }
        } finally {
            setIsThinking(false);
        }
    };

    const speak = (text) => {
        if (synthRef.current.speaking) synthRef.current.cancel();

        // LIMPIEZA DE NÚMEROS PARA VOZ:
        // Convierte "384.400" -> "384400" para que no lea "punto"
        // Regex: Busca dígito + punto + 3 dígitos exactamente (al final o seguido de no-dígito)
        const voiceText = text.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');

        const utterance = new SpeechSynthesisUtterance(voiceText);
        utterance.lang = 'es-US';
        utterance.rate = 1.0;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        // Selección de Voz (Automática / Mejor Calidad)
        const voices = synthRef.current.getVoices();
        const esVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));

        // Prioridad: Voces de alta calidad conocidas
        const preferredNames = ['Google español', 'Paulina', 'Monica', 'Samantha', 'Helena', 'Sabina', 'Mexico', 'Microsoft Sabina', 'Microsoft Helena'];

        const bestVoice = esVoices.find(v => preferredNames.some(n => v.name.includes(n)));

        if (bestVoice) {
            utterance.voice = bestVoice;
        } else if (esVoices.length > 0) {
            utterance.voice = esVoices[0];
        }

        utterance.pitch = 1.0;
        utterance.rate = 1.0;

        synthRef.current.speak(utterance);
    };

    const toggleListening = () => {
        // PARADA DE EMERGENCIA
        if (isSpeaking) {
            synthRef.current.cancel();
            setIsSpeaking(false);
            setMessages([]);
            return;
        }
        if (isThinking) {
            if (abortControllerRef.current) abortControllerRef.current.abort();
            setIsThinking(false);
            setMessages([]);
            return;
        }
        // TOGGLE MIC
        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            setError('');
            // setMessages([]); <--- ELIMITADO: YA NO BORRA LA MEMORIA AL HABLAR
            recognitionRef.current?.start();
        }
    };

    return (
        <div className='container'>
            <div className='header'>
                <h1>⚡ OLGA AI</h1>
                <p>Neural Network • Llama 3 • Live Search</p>
                {/* DEBUG INDICATOR */}
                <span style={{ fontSize: '0.7rem', color: API_KEY ? '#4caf50' : '#ff5555', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                    {API_KEY ? '✅ Sistema Online' : `❌ Falta API Key (${API_KEY?.length || 0})`}
                </span>
            </div>

            <button
                onClick={() => { setMessages([]); if (isSpeaking) synthRef.current.cancel(); setIsSpeaking(false); }}
                style={{
                    position: 'absolute', top: '20px', right: '20px',
                    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
                    width: '40px', height: '40px', cursor: 'pointer', fontSize: '1.2rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
                    color: '#fff'
                }}
                title="Nueva Conversación"
            >
                🗑️
            </button>
            <div className='main-content'>

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
            </div>
        </div>
    );
}
