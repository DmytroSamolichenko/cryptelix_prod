import { useState } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type ColumnType = 'text' | 'number' | 'percentage';

interface AddColumnModalProps {
  onClose: () => void;
  onAdd: (column: { name: string; type: ColumnType }) => void;
}

export function AddColumnModal({ onClose, onAdd }: AddColumnModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ColumnType>('text');

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed, type });
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-md mx-4 rounded-2xl border border-yellow-500/30 bg-zinc-900/95 shadow-2xl"
        >
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Add New Column</h3>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Column Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., ROI, Win Rate, Strategy"
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-900 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/60 focus:border-yellow-500/60"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Column Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('text')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      type === 'text'
                        ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400'
                        : 'bg-zinc-800 border-zinc-700 text-gray-300 hover:border-zinc-500'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('number')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      type === 'number'
                        ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400'
                        : 'bg-zinc-800 border-zinc-700 text-gray-300 hover:border-zinc-500'
                    }`}
                  >
                    Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('percentage')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      type === 'percentage'
                        ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400'
                        : 'bg-zinc-800 border-zinc-700 text-gray-300 hover:border-zinc-500'
                    }`}
                  >
                    Percent
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-sm font-medium text-gray-100 hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!name.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-yellow-500 text-sm font-semibold text-black hover:bg-yellow-400 disabled:bg-zinc-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  Add Column
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

