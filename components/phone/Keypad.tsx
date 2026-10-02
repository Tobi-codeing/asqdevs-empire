"use client";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export default function Keypad({
  onPress,
  disabled,
}: {
  onPress: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {KEYS.map((key) => (
        <button
          key={key}
          onClick={() => onPress(key)}
          disabled={disabled}
          aria-label={`Key ${key}`}
          className="h-14 min-h-14 border border-[#2a2a2a] text-2xl font-light transition-colors hover:border-[#c6ad78] hover:bg-[#c6ad78]/5 active:bg-[#c6ad78]/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {key}
        </button>
      ))}
    </div>
  );
}
