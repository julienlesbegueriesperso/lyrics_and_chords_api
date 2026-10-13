interface Props {
  transpose: number;
  useSharps: boolean;
  onShift: (delta: number) => void;
  onReset: () => void;
  onToggleSpelling: () => void;
}

export function TransposeBar({ transpose, useSharps, onShift, onReset, onToggleSpelling }: Props) {
  return (
    <div className="transpose-bar">
      <span className="transpose-label">Transposer</span>
      <button type="button" className="btn" onClick={() => onShift(-1)} title="Descendre d'un demi-ton">
        −1
      </button>
      <button type="button" className="btn" onClick={() => onShift(1)} title="Monter d'un demi-ton">
        +1
      </button>
      <span className={`transpose-value${transpose === 0 ? ' zero' : ''}`} title="Décalage en demi-tons">
        {transpose > 0 ? `+${transpose}` : transpose} ½-ton
      </span>
      <button type="button" className="btn ghost" onClick={onToggleSpelling} title="Notation dièses / bémols">
        {useSharps ? '♯' : '♭'}
      </button>
      {transpose !== 0 && (
        <button type="button" className="btn ghost" onClick={onReset} title="Revenir à l'original">
          Reset
        </button>
      )}
    </div>
  );
}
