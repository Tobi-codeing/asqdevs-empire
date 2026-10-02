'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

/**
 * The message composer.
 *
 * Free text is always available and never disabled by the conversation state —
 * the buttons are suggestions, not a form, so a visitor is never forced down a
 * path the assistant decided for them. Enter sends on a physical keyboard;
 * Shift+Enter is not needed for a single-line field, so Enter always sends.
 */
export default function Composer({
  onSend,
  disabled,
  placeholder = 'Type a message…',
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-3 border-t border-[#1f1f1f] bg-[#0b0b0b] p-3 sm:p-4 lg:px-8 lg:py-5"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message"
        autoComplete="off"
        enterKeyHint="send"
        className="type-body min-w-0 flex-1 border border-[#2a2a2a] bg-transparent px-4 py-3.5 text-[#f5f3f0] placeholder:text-[#f5f3f0]/30 outline-none transition-colors focus:border-[#c6ad78] disabled:opacity-50 sm:px-5 sm:py-4"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center bg-[#c6ad78] text-[#0a0a0a] transition-colors hover:bg-[#aa925f] disabled:cursor-not-allowed disabled:opacity-40 sm:h-[58px] sm:w-[58px]"
      >
        <Send className="h-5 w-5" />
      </button>
    </form>
  );
}
