
import React, { useEffect, useState } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking }) => {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let frame: number;
    const animate = () => {
      setRotation(prev => (prev + (isSpeaking ? 5 : 0.5)) % 360);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [isSpeaking]);

  return (
    <div className="relative flex items-center justify-center w-64 h-64 md:w-80 md:h-80">
      {/* Outer Rotating Ring */}
      <div 
        className={`absolute inset-0 border-[1px] border-dashed border-cyan-500/30 rounded-full transition-transform duration-1000`}
        style={{ transform: `rotate(${rotation}deg)` }}
      />
      
      {/* Inner Radar Rings */}
      <div className={`absolute inset-4 border-[2px] border-cyan-400/20 rounded-full ${isSpeaking ? 'animate-ping' : ''}`} />
      <div className="absolute inset-8 border-[1px] border-cyan-400/10 rounded-full" />
      
      {/* Core Display */}
      <div className="relative z-10 flex flex-col items-center">
        <div className={`text-4xl font-bold tracking-[0.2em] transition-all duration-300 ${isSpeaking ? 'text-cyan-400 scale-110 glow-cyan' : 'text-white'}`}>
          ISHU
        </div>
        <div className="mt-2 text-[8px] tracking-[0.4em] opacity-40 uppercase">Neural Core v2.2</div>
      </div>

      {/* Pulsing Arcs */}
      <svg className="absolute inset-0 w-full h-full -rotate-90">
        <circle
          cx="50%" cy="50%" r="48%"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="20 180"
          className={`text-cyan-400 transition-opacity duration-500 ${isActive ? 'opacity-100' : 'opacity-0'}`}
          style={{ transform: `rotate(${rotation * 2}deg)`, transformOrigin: 'center' }}
        />
        <circle
          cx="50%" cy="50%" r="45%"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="40 120"
          className={`text-cyan-500/40 transition-opacity duration-500 ${isActive ? 'opacity-100' : 'opacity-0'}`}
          style={{ transform: `rotate(${-rotation}deg)`, transformOrigin: 'center' }}
        />
      </svg>
    </div>
  );
};

export default Visualizer;
