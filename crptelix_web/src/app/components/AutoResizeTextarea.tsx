import { useState, useRef, useEffect } from 'react';

export function AutoResizeTextarea() {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;

    // Reset height to get accurate scrollHeight
    textarea.style.height = 'auto';

    // Calculate new height based on content
    const newHeight = Math.max(30, textarea.scrollHeight);

    // Update textarea height
    textarea.style.height = `${newHeight}px`;
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  };

  return (
    <div className="w-full h-full flex items-start justify-start">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        className="bg-transparent text-white resize-none focus:outline-none w-full border-none"
        placeholder="Type here..."
        style={{
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          overflow: 'hidden',
          minHeight: '30px',
          padding: 0,
          lineHeight: '1.5',
        }}
      />
    </div>
  );
}