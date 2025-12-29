import React from 'react';
import { Illustration } from '../types';

interface Props {
  item: Illustration;
  isLatest?: boolean;
}

export const IllustrationCard: React.FC<Props> = ({ item, isLatest }) => {
  return (
    <div className={`relative group transition-all duration-500 ${isLatest ? 'scale-100' : 'scale-95 opacity-80'}`}>
      <div className="relative overflow-hidden rounded-2xl shadow-2xl bg-white border-4 border-white aspect-[4/3] md:aspect-square">
        <img 
          src={item.url} 
          alt={item.prompt} 
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
          <p className="text-white text-sm font-medium line-clamp-2 font-display">{item.prompt}</p>
        </div>
      </div>
      {isLatest && (
        <div className="absolute -top-3 -right-3 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full shadow-lg animate-bounce">
          Nou! (New!)
        </div>
      )}
    </div>
  );
};