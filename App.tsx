
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ActionLog, NovaState, Transcription } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audioHelper';
import Visualizer from './components/Visualizer';

// Fix: All declarations of 'aistudio' must have identical modifiers.
// Using readonly and inline definition to match potential environment defaults.
declare global {
  interface Window {
    readonly aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const ISHU_PROMPT = `Role: You are "Ishu" (ঈশু), an elite AI voice assistant core.
Personality: Witty, helpful, and high-tech.
Primary Language: Bengali (বাংলা).

Abilities:
1. Real-time conversation: Answer anything in Bengali.
2. Web Search: If information is needed, use your internal knowledge and speak.
3. Image Generation: If asked for a photo/image, use the tag [ACTION: GEN_IMAGE: prompt].

Rules:
- Respond instantly when called by name "ঈশু".
- Always speak in natural, fluent Bengali.
- Keep responses concise for voice interaction.`;

const App: React.FC = () => {
  const [state, setState] = useState<NovaState>(NovaState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionLog[]>([]);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [time, setTime] = useState(new Date());
  const [cpu, setCpu] = useState(42);
  const [lastImageUrl, setLastImageUrl] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentOutputText = useRef('');

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        try {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          if (!hasKey) {
            setState(NovaState.AUTH);
          }
        } catch (e) {
          setState(NovaState.AUTH);
        }
      }
    };
    checkKey();

    const timer = setInterval(() => setTime(new Date()), 1000);
    const cpuTimer = setInterval(() => setCpu(prev => Math.max(10, Math.min(95, prev + (Math.random() * 10 - 5)))), 2000);
    return () => { clearInterval(timer); clearInterval(cpuTimer); };
  }, []);

  const handleOpenKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setState(NovaState.IDLE);
      setErrorMessage(null);
    }
  };

  const initAudio = async () => {
    if (!inputAudioCtxRef.current) {
      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputNodeRef.current = outputAudioCtxRef.current.createGain();
      outputNodeRef.current.connect(outputAudioCtxRef.current.destination);
    }
  };

  const generateImage = async (prompt: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      // Correcting contents parameter to use Part object directly in a Content object
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
      });
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setLastImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          setActions(prev => [{ id: Date.now().toString(), type: 'SYNTHESIS', timestamp: new Date(), description: 'একটি ছবি তৈরি করা হয়েছে।' }, ...prev]);
          break;
        }
      }
    } catch (e: any) {
      if (e.message?.includes("Requested entity was not found")) {
        console.warn("Invalid Key Detected during Image Gen");
        setState(NovaState.AUTH);
      }
    }
  };

  const handleActionParsing = (text: string) => {
    const actionRegex = /\[ACTION:\s*([A-Z0-9_:]+)\s*\]/g;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      const fullAction = match[1];
      if (fullAction.startsWith('GEN_IMAGE:')) {
        generateImage(fullAction.split('GEN_IMAGE:')[1].trim());
      }
    }
  };

  const startIshuCall = async () => {
    setErrorMessage(null);
    try {
      setState(NovaState.CONNECTING);
      await initAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: ISHU_PROMPT,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setState(NovaState.LISTENING);
            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setState(NovaState.SPEAKING);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current!.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioCtxRef.current!, 24000, 1);
              const source = outputAudioCtxRef.current!.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current!);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setState(NovaState.LISTENING);
              });
              sourcesRef.current.add(source);
            }
            if (msg.serverContent?.outputTranscription) {
              currentOutputText.current += msg.serverContent.outputTranscription.text;
              handleActionParsing(msg.serverContent.outputTranscription.text);
            }
            if (msg.serverContent?.turnComplete) {
              if (currentOutputText.current) {
                setTranscriptions(prev => [{ role: 'ishu', text: currentOutputText.current, timestamp: new Date() }, ...prev].slice(0, 3));
                currentOutputText.current = '';
              }
            }
            if (msg.serverContent?.interrupted) {
              for (const source of sourcesRef.current) {
                try { source.stop(); } catch(e) {}
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setState(NovaState.LISTENING);
            }
          },
          onerror: (e: any) => {
            console.error("Live session error:", e);
            if (e.message?.includes("Requested entity was not found")) {
              setState(NovaState.AUTH);
              setErrorMessage("আপনার এপিআই কী-টি বৈধ নয় অথবা বিলিং সেটআপ নেই।");
            } else {
              setState(NovaState.ERROR);
              setErrorMessage("কানেকশনে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
            }
          },
          onclose: () => {
            setState(NovaState.IDLE);
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) {
      console.error("Start call error:", e);
      if (e.message?.includes("Requested entity was not found")) {
        setState(NovaState.AUTH);
      } else {
        setState(NovaState.ERROR);
        setErrorMessage(e.message || "একটি এরর হয়েছে।");
      }
    }
  };

  if (state === NovaState.AUTH) {
    return (
      <div className="h-screen w-screen bg-[#020406] flex items-center justify-center p-6 font-mono">
        <div className="max-w-md w-full border border-cyan-400/30 p-10 rounded-[2rem] bg-white/[0.02] backdrop-blur-3xl text-center relative overflow-hidden shadow-[0_0_50px_rgba(34,211,238,0.1)]">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent" />
          <div className="w-24 h-24 border-2 border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-10 relative">
             <div className="w-12 h-12 bg-red-400/20 rotate-45 border border-red-400/50 animate-pulse" />
          </div>
          <h2 className="text-red-400 text-xl font-bold tracking-[0.4em] mb-6 uppercase">Key Error Detected</h2>
          <div className="space-y-4 mb-10">
            <p className="text-[13px] text-cyan-100/70 leading-relaxed">
              সিস্টেম <span className="text-red-400 font-bold italic">"Requested entity was not found"</span> এরর দিয়েছে। 
            </p>
            <p className="text-[12px] text-white/60">
              এর মানে আপনার এপিআই কী-টি সঠিক নয় অথবা এটি কোনো <span className="text-cyan-400 font-bold underline">Paid Project</span>-এর সাথে যুক্ত নয়। 
            </p>
            <p className="text-[11px] text-white/30 italic">
              অনুগ্রহ করে নিচের বাটনে ক্লিক করে পুনরায় একটি বৈধ এপিআই কী নির্বাচন করুন।
            </p>
          </div>
          <button 
            onClick={handleOpenKey}
            className="w-full py-5 bg-red-500/20 border border-red-400/60 rounded-2xl text-red-400 text-sm font-bold tracking-[0.2em] hover:bg-red-500/30 transition-all duration-300 transform active:scale-95"
          >
            RE-SELECT ACCESS KEY
          </button>
          <div className="mt-8">
            <a 
              href="https://ai.google.dev/gemini-api/docs/billing" 
              target="_blank" 
              className="text-[10px] opacity-40 hover:opacity-100 hover:text-cyan-400 underline transition-all tracking-wider"
            >
              Learn about Paid Projects & Billing
            </a>
          </div>
        </div>
      </div>
    );
  }

  const StatBar = ({ label, value, color }: { label: string, value: number, color: string }) => (
    <div className="mb-4">
      <div className="flex justify-between text-[10px] mb-1 uppercase opacity-70 font-mono tracking-tighter">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="progress-bar rounded-full h-1 bg-white/5">
        <div className={`progress-fill ${color} rounded-full transition-all duration-1000 shadow-[0_0_5px_currentColor]`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen flex flex-col p-6 select-none overflow-hidden relative bg-[#020406] text-white">
      {/* HUD Header */}
      <div className="flex justify-between items-start z-20">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 border border-cyan-400/30 rounded-full flex items-center justify-center bg-cyan-400/5 ${state !== NovaState.IDLE ? 'animate-pulse' : ''} shadow-[inset_0_0_10px_rgba(34,211,238,0.1)]`}>
             <div className={`w-3 h-3 rounded-full ${state === NovaState.ERROR ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : 'bg-cyan-400 shadow-[0_0_10px_#22d3ee]'}`} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-[0.5em] text-cyan-400 glow-cyan uppercase">ISHU VISION v3.2</h1>
            <div className="text-[9px] opacity-40 uppercase tracking-widest mt-1 flex gap-4">
              <span>Status: <span className={state === NovaState.ERROR ? 'text-red-400' : 'text-cyan-400'}>{state}</span></span>
              <span className="opacity-50">|</span>
              <span>Encrypted Neural Stream</span>
            </div>
          </div>
        </div>
        <div className="text-right font-mono">
           <div className="text-2xl font-light text-cyan-200/80 tracking-widest">{time.toLocaleTimeString([], { hour12: false })}</div>
           <div className="text-[8px] opacity-30 uppercase tracking-[0.3em] mt-1">{time.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-8 mt-12">
        {/* Left Diagnostics */}
        <div className="col-span-3 flex flex-col gap-6">
          <div className="bg-white/[0.03] border border-white/10 p-5 backdrop-blur-xl rounded-2xl relative">
            <h3 className="text-[10px] font-bold mb-6 tracking-widest uppercase text-cyan-400/70 font-mono">Biometric Analytics</h3>
            <StatBar label="Neural Synchronization" value={state !== NovaState.IDLE ? 98 : 0} color="bg-cyan-500" />
            <StatBar label="Voice Processor" value={state === NovaState.SPEAKING ? 88 : 5} color="bg-emerald-500" />
            <StatBar label="Hardware Load" value={cpu} color="bg-indigo-500" />
          </div>
          <div className="flex-1 bg-white/[0.03] border border-white/10 p-5 rounded-2xl flex flex-col overflow-hidden">
             <h3 className="text-[9px] font-bold mb-4 tracking-widest uppercase opacity-40 font-mono">Live Logs</h3>
             <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-2">
                {actions.map(action => (
                  <div key={action.id} className="text-[9px] border-l border-cyan-400/20 pl-3 py-1.5 animate-in fade-in slide-in-from-left-2">
                    <div className="text-cyan-400/50 font-mono text-[8px]">{action.timestamp.toLocaleTimeString()}</div>
                    <div className="opacity-60 mt-0.5">{action.description}</div>
                  </div>
                ))}
                {actions.length === 0 && <div className="text-[9px] opacity-20 italic">সিস্টেম লগ শূন্য...</div>}
             </div>
          </div>
        </div>

        {/* Center Core */}
        <div className="col-span-6 flex flex-col items-center justify-center relative">
           <Visualizer isActive={state !== NovaState.IDLE} isSpeaking={state === NovaState.SPEAKING} />
           <div className="mt-12 h-32 flex flex-col items-center justify-center px-12 text-center w-full z-10">
             {state === NovaState.ERROR && errorMessage && (
               <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl animate-bounce">
                  <p className="text-red-400 text-xs font-mono uppercase tracking-widest mb-2 font-bold">Error Detected</p>
                  <p className="text-red-200 text-xs italic">"{errorMessage}"</p>
               </div>
             )}
             {transcriptions.length > 0 && !errorMessage && (
               <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 bg-cyan-400/5 border border-cyan-400/10 p-5 rounded-2xl backdrop-blur-md">
                  <div className="text-cyan-50 text-base font-medium leading-relaxed italic drop-shadow-[0_0_8px_rgba(34,211,238,0.3)]">
                    "{transcriptions[0].text}"
                  </div>
               </div>
             )}
             {state === NovaState.LISTENING && !transcriptions.length && !errorMessage && (
               <div className="flex flex-col items-center gap-4">
                 <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
                      <div key={i} className={`w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce`} style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                 </div>
                 <span className="text-[10px] text-cyan-400/60 uppercase tracking-[0.4em] font-bold">ঈশু শুনছে...</span>
               </div>
             )}
           </div>
        </div>

        {/* Right Side Vision */}
        <div className="col-span-3 flex flex-col gap-6">
          <div className="bg-white/[0.03] border border-white/10 p-5 rounded-2xl flex-1 flex flex-col">
            <h3 className="text-[10px] font-bold mb-4 tracking-widest uppercase text-cyan-400/70 font-mono border-b border-white/5 pb-2">Vision Input</h3>
            <div className="flex-1 bg-black/40 rounded-xl border border-white/5 relative overflow-hidden flex items-center justify-center">
               {lastImageUrl ? (
                 <img src={lastImageUrl} className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-1000" alt="Generated" />
               ) : (
                 <div className="text-[9px] opacity-20 text-center px-4 uppercase tracking-widest leading-loose">
                    Neural Vision Empty<br/>Request Image in Bengali
                 </div>
               )}
            </div>
          </div>
          <div className="mt-auto space-y-4">
             <button 
                onClick={state === NovaState.IDLE || state === NovaState.ERROR ? startIshuCall : () => sessionRef.current?.close()}
                className={`w-full py-7 rounded-2xl text-[12px] font-bold uppercase tracking-[0.5em] border transition-all duration-500 group relative overflow-hidden shadow-2xl ${
                  (state === NovaState.IDLE || state === NovaState.ERROR) 
                  ? 'bg-cyan-500/10 border-cyan-400/30 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-400' 
                  : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
                }`}
              >
                {state === NovaState.IDLE || state === NovaState.ERROR ? (
                  <div className="flex flex-col gap-1 items-center">
                    <span>ঈশুর সাথে কথা বলুন</span>
                    <span className="text-[7px] opacity-40 font-normal tracking-[0.2em]">INITIALIZE NEURAL LINK</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 items-center">
                    <span>সংযোগ বিচ্ছিন্ন করুন</span>
                    <span className="text-[7px] opacity-40 font-normal tracking-[0.2em]">TERMINATE LINK</span>
                  </div>
                )}
              </button>
          </div>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 w-full h-14 bg-[#05080c]/90 backdrop-blur-2xl border-t border-white/5 flex items-center px-10 justify-between z-50">
        <div className="flex items-center gap-12 text-[10px] font-mono font-bold">
           <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${state === NovaState.LISTENING ? 'bg-cyan-400 animate-pulse' : state === NovaState.SPEAKING ? 'bg-emerald-400' : 'bg-gray-800'}`} />
              <span className={`uppercase tracking-widest ${state === NovaState.ERROR ? 'text-red-400' : 'text-cyan-400'}`}>{state}</span>
           </div>
           <div className="opacity-30 tracking-widest">SYSTEM: ISHU_3.2</div>
        </div>
        <div className="flex items-center gap-6">
           <div className="text-cyan-400 text-xs font-mono tracking-widest opacity-80">
              {time.getHours().toString().padStart(2, '0')}:{time.getMinutes().toString().padStart(2, '0')}:{time.getSeconds().toString().padStart(2, '0')}
           </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
