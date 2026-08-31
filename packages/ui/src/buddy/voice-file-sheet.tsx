type Props = {
  open: boolean;
  onClose: () => void;
  onPick: () => void;
};

export function BuddyVoiceFileSheet({ open, onClose, onPick }: Props) {
  if (!open) return null;
  return (
    <div className="buddy-sheet-root">
      <button type="button" className="buddy-sheet-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="buddy-sheet" role="dialog" aria-label="选录音">
        <span className="buddy-sheet-handle" />
        <h3>选一段录音</h3>
        <p className="buddy-sheet-copy">
          当前是 HTTP，手机不让网页直接开麦。请选语音备忘录或文件里的录音（m4a / mp3 / wav）。不要点「录像」或相册。
        </p>
        <button type="button" className="buddy-sheet-primary" onClick={onPick}>
          选录音文件
        </button>
      </div>
    </div>
  );
}
